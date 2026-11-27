#!/usr/bin/env python3
"""VIGIL occupancy training: CO2 mass balance + Ridge error correction.

Put your labeled occupancy CSVs into ./data/occupancy/
Put genuinely outdoor CO2 CSVs into ./data/outdoor/
Run: python train_vigil_occupancy_hybrid.py

Output: output_occupancy/vigil_hybrid_occupancy_model.h plus CSV/JSON reports.

EXPERIMENTAL: occupancy estimates are not guaranteed accurate. G and ACH are
assumptions unless you measured them. No automatic inference of outdoor status.
"""
from __future__ import annotations

from collections import deque
from pathlib import Path
import json
import warnings
import numpy as np
import pandas as pd
from sklearn.linear_model import Ridge

# ========== EDIT THESE SETTINGS IF NEEDED ==========
ROOT = Path(__file__).resolve().parent
OCCUPANCY_DIR = ROOT / "data" / "occupancy"    # labeled files
OUTDOOR_DIR = ROOT / "data" / "outdoor"        # outdoor reference files
OUTPUT_DIR = ROOT / "output_occupancy"

ROOM_VOLUME_M3 = 43.6079          # used only if missing in the data
CO2_GENERATION_L_H_PERSON = 15.0  # ASSUMPTION, not measured
VENTILATION_ACH = 0.5             # ASSUMPTION, not measured
OUTDOOR_CO2_OVERRIDE = None       # e.g. 440.0, if no outdoor CSVs
INDOOR_BASELINE_OVERRIDE = None   # e.g. 511.0, if no baseline values
MAX_PEOPLE = 16.0

RIDGE_ALPHAS = (1.0, 10.0, 100.0)
HISTORY_SEC = 180.0
MAX_GAP_SEC = 40.0
MIN_SPAN_60 = 40.0
MIN_SPAN_180 = 150.0
SCALE_PHYSICS, SCALE_DELTA, SCALE_RATE = 10.0, 100.0, 10.0
# =====================================================


def scan_csvs(folder: Path):
    return sorted(folder.glob("*.csv")) if folder.exists() else []


def find_col(df, choices, required=True):
    for col in choices:
        if col in df.columns:
            return col
    if required:
        raise ValueError(f"Need one of {choices}; found {list(df.columns)}")
    return None


def load_occupancy_file(path: Path):
    d = pd.read_csv(path)
    co2 = find_col(d, ("scd40_co2_ppm", "CO2_ppm", "co2_ppm"))
    people = find_col(d, ("ground_truth_people", "Actual_People", "actual_people", "occupancy"))
    uptime = find_col(d, ("device_uptime_ms", "Uptime_s"), required=False)
    timestamp = find_col(d, ("pc_timestamp_local", "PC_Time", "timestamp"), required=False)
    if not uptime and not timestamp:
        raise ValueError(f"{path.name}: must have device uptime or timestamp")

    d["co2"] = pd.to_numeric(d[co2], errors="coerce")
    d["people"] = pd.to_numeric(d[people], errors="coerce")
    if uptime:
        d["seconds"] = pd.to_numeric(d[uptime], errors="coerce")
        if uptime.endswith("_ms"):
            d["seconds"] /= 1000.0
    else:
        tm = pd.to_datetime(d[timestamp], errors="coerce", utc=True)
        d["seconds"] = (tm - tm.dropna().min()).dt.total_seconds()
    if "training_eligible" in d:
        d["eligible"] = pd.to_numeric(d["training_eligible"], errors="coerce") == 1
    else:
        d["eligible"] = True
    if "phase" in d:
        d["phase_label"] = d["phase"].astype(str).str.upper()
    else:
        d["phase_label"] = "OCCUPIED"
    if "room_volume_m3" in d:
        d["volume"] = pd.to_numeric(d["room_volume_m3"], errors="coerce")
    else:
        d["volume"] = ROOM_VOLUME_M3
    if "empty_baseline_co2_ppm" in d:
        d["baseline_hint"] = pd.to_numeric(d["empty_baseline_co2_ppm"], errors="coerce")
    else:
        d["baseline_hint"] = np.nan

    if "session_id" in d:
        # Related/augmented CSVs with the same session ID stay in one evaluation group.
        d["run_group"] = d["session_id"].astype(str)
    else:
        d["run_group"] = path.stem
    d["file_source"] = path.stem
    d = d[d.co2.between(300, 5000) & d.volume.gt(0) & d.seconds.notna()].copy()
    return d.sort_values(["run_group", "seconds"], kind="stable")


def find_outdoor_reference(paths):
    medians = []
    details = []
    for path in paths:
        d = pd.read_csv(path)
        col = find_col(d, ("CO2_ppm", "scd40_co2_ppm", "co2_ppm"))
        co2 = pd.to_numeric(d[col], errors="coerce")
        co2 = co2[co2.between(300, 2000)]
        if len(co2) < 20:
            warnings.warn(f"Skipping insufficient outdoor file: {path.name}")
            continue
        m = float(co2.median())
        medians.append(m)
        details.append({"file": path.name, "median_ppm": m, "samples": len(co2)})
    if not medians:
        raise ValueError("No usable outdoor CO2 recordings. Check data/outdoor/")
    return float(np.median(medians)), details


def slope_ppm_per_min(samples, now, window, minspan):
    a = [(t, c) for t, c in samples if now - t <= window]
    if len(a) < 4 or a[-1][0] - a[0][0] < minspan:
        return np.nan
    times = np.array([t for t, _ in a], float)
    vals = np.array([c for _, c in a], float)
    times -= np.mean(times)
    denom = float(np.dot(times, times))
    return float(60.0 * np.dot(times, vals - vals.mean()) / denom) if denom > 0 else np.nan


def find_indoor_reference(frames):
    # Prefer an explicitly identified real empty-room file over augmented runs.
    priority = []
    ordinary = []
    for d in frames:
        base = d[(d.phase_label == "BASELINE") & d.eligible & d.people.eq(0)]
        if len(base) < 10:
            continue
        median = float(base.co2.median())
        filename = str(d.file_source.iloc[0]).lower()
        if "empty_room" in filename or "empty-room" in filename:
            priority.append(median)
        else:
            ordinary.append(median)
    if priority:
        return float(np.median(priority)), "dedicated_empty_room_CSV"
    if ordinary:
        return float(np.median(ordinary)), "measured_baseline_files"
    hints = [float(x) for d in frames for x in d.baseline_hint.dropna().unique()
             if 300 <= x <= 2000]
    if hints:
        return float(np.median(hints)), "CSV_baseline_metadata"
    if INDOOR_BASELINE_OVERRIDE is not None:
        return float(INDOOR_BASELINE_OVERRIDE), "manual_override"
    raise ValueError("No indoor empty baseline found. Add a labeled 0-person CSV or set INDOOR_BASELINE_OVERRIDE.")


def make_features(frames, indoor_base, outdoor_co2):
    out = []
    for d in frames:
        # Never join historical streams merely because the session ID matches.
        for group_id, part in d.groupby("run_group", sort=False):
            hist = deque(maxlen=96)
            last_t = None
            part = part.sort_values("seconds", kind="stable")
            base_hint = part.baseline_hint.dropna()
            this_baseline = float(base_hint.median()) if len(base_hint) else indoor_base
            base_part = part[(part.phase_label == "BASELINE") & part.eligible & part.people.eq(0)]
            if len(base_part) >= 10:
                this_baseline = float(base_part.co2.median())
            for row in part.itertuples():
                t, c = float(row.seconds), float(row.co2)
                if last_t is not None and (t <= last_t or t - last_t > MAX_GAP_SEC):
                    hist.clear()
                last_t = t
                hist.append((t, c))
                while hist and t - hist[0][0] > HISTORY_SEC:
                    hist.popleft()
                slope60 = slope_ppm_per_min(hist, t, 60.0, MIN_SPAN_60)
                slope180 = slope_ppm_per_min(hist, t, HISTORY_SEC, MIN_SPAN_180)
                if not (np.isfinite(slope60) and np.isfinite(slope180)):
                    continue
                if not row.eligible or row.phase_label not in ("BASELINE", "OCCUPIED"):
                    continue
                if not np.isfinite(row.people) or row.people < 0:
                    continue
                recent60 = [v for ts, v in hist if t-ts <= 60.0]
                mean60 = float(np.mean(recent60))
                vol = float(row.volume)
                phys = vol / (1000.0 * CO2_GENERATION_L_H_PERSON) * (
                    60.0 * slope180 + VENTILATION_ACH * (mean60-outdoor_co2))
                out.append({"source": row.file_source, "run_group": group_id,
                            "people": float(row.people), "volume_m3": vol,
                            "mean_co2_60": mean60, "rate_60_ppm_min": slope60,
                            "rate_180_ppm_min": slope180,
                            "indoor_baseline": this_baseline,
                            "delta_indoor_ppm": mean60 - this_baseline,
                            "physics_people": phys})
    if not out:
        raise ValueError("Not enough continuous labeled data: need ~3 min per recording to compute slopes")
    return pd.DataFrame(out)


def X_hybrid(d):
    return np.column_stack((d.physics_people / SCALE_PHYSICS,
                            d.delta_indoor_ppm / SCALE_DELTA,
                            d.rate_60_ppm_min / SCALE_RATE))


def X_ridge(d):
    return np.column_stack((d.delta_indoor_ppm / SCALE_DELTA,
                            d.rate_60_ppm_min / SCALE_RATE,
                            d.rate_180_ppm_min / SCALE_RATE))


def weights(d):
    # Equal mass to each independent run and people-count level.
    # If derivative files share run_group, their extra samples do not multiply
    # the total contribution of that underlying recording.
    w = pd.Series(np.zeros(len(d)), index=d.index, dtype=float)
    groups = list(d.groupby("run_group"))
    for _, group in groups:
        levels = list(group.groupby("people"))
        for _, one_level in levels:
            w.loc[one_level.index] = 1.0 / (len(groups) * len(levels) * len(one_level))
    return w.to_numpy() * len(d) / w.sum()


def fit(d, alpha, hybrid):
    x = X_hybrid(d) if hybrid else X_ridge(d)
    y = d.people.to_numpy() - (d.physics_people.to_numpy() if hybrid else 0)
    m = Ridge(alpha=alpha)
    m.fit(x, y, sample_weight=weights(d))
    return m


def predict(d, model, hybrid):
    x = X_hybrid(d) if hybrid else X_ridge(d)
    raw = model.predict(x) + (d.physics_people.to_numpy() if hybrid else 0)
    return np.clip(raw, 0, MAX_PEOPLE)


def folds(d):
    runs = d.run_group.unique()
    if len(runs) >= 3:
        return [(f"run:{s}", d.run_group != s, d.run_group == s) for s in runs], "leave_one_recording_out"
    # Development-only diagnostic when independent recordings are insufficient.
    levels = d.people.unique()
    return [(f"people:{x:g}", d.people != x, d.people == x) for x in levels], "leave_one_occupancy_level_out_NOT_independent"


def cross_validate(d, alpha, hybrid):
    the_folds, method = folds(d)
    results = []
    for name, train_mask, test_mask in the_folds:
        tr, te = d[train_mask], d[test_mask]
        if len(tr) < 15 or len(te) == 0:
            continue
        model = fit(tr, alpha, hybrid)
        p = predict(te, model, hybrid)
        results.append({"fold": name, "n": len(te),
                        "mae_people": float(np.mean(abs(p - te.people.to_numpy()))),
                        "mean_actual": float(te.people.mean()),
                        "mean_predicted": float(np.mean(p))})
    if not results:
        raise ValueError("Too little labeled data for cross-validation")
    return pd.DataFrame(results), method


def float_cpp(val):
    s = f"{float(val):.10g}"
    if "e" not in s.lower() and "." not in s:
        s += ".0"
    return s + "f"


def write_header(path, model, cout, indoor, volume, alpha):
    f = float_cpp
    a, b, c = [f(v) for v in model.coef_]
    contents = f'''// Automatically generated by train_vigil_occupancy_hybrid.py
// Experimental occupancy estimator. ACH & G are assumptions unless measured.
#pragma once
#include <math.h>
#include <stdint.h>
namespace VigilHybridOcc {{
constexpr float ROOM_VOLUME_M3 = {f(volume)};
constexpr float OUTDOOR_CO2_PPM = {f(cout)};
constexpr float INDOOR_BASELINE_PPM = {f(indoor)};
constexpr float G_L_H_PERSON = {f(CO2_GENERATION_L_H_PERSON)};
constexpr float ACH_PER_H = {f(VENTILATION_ACH)};
constexpr float MAX_PEOPLE = {f(MAX_PEOPLE)};
constexpr float RIDGE_INTERCEPT = {f(model.intercept_)};
constexpr float BETA[3] = {{ {a}, {b}, {c} }};
constexpr float RIDGE_ALPHA = {f(alpha)};

inline float physics(float mean60, float slope180ppmMin,
                     float outside=OUTDOOR_CO2_PPM) {{
  return ROOM_VOLUME_M3 / (1000.0f*G_L_H_PERSON) *
     (60.0f*slope180ppmMin + ACH_PER_H*(mean60-outside));
}}
inline float predict(float mean60, float slope60ppmMin, float slope180ppmMin,
                     float emptyIndoor=INDOOR_BASELINE_PPM,
                     float outside=OUTDOOR_CO2_PPM) {{
  const float p = physics(mean60, slope180ppmMin, outside);
  const float correction = RIDGE_INTERCEPT + BETA[0]*(p/10.0f)
       + BETA[1]*((mean60-emptyIndoor)/100.0f)
       + BETA[2]*(slope60ppmMin/10.0f);
  const float n = p + correction;
  if (!isfinite(n)) return NAN;
  return n < 0 ? 0.0f : (n > MAX_PEOPLE ? MAX_PEOPLE : n);
}}
// Requires a recent 60-s CO2 mean, 60-s slope and 180-s slope
// (slopes expressed in ppm per MINUTE). No ML library required on ESP32.
}} // namespace VigilHybridOcc
'''
    path.write_text(contents, encoding="utf-8")


def main():
    if CO2_GENERATION_L_H_PERSON <= 0 or VENTILATION_ACH < 0 or ROOM_VOLUME_M3 <= 0:
        raise ValueError("Invalid G, ACH or room volume settings")
    occ_files = scan_csvs(OCCUPANCY_DIR)
    if not occ_files:
        raise FileNotFoundError(f"Put labeled occupancy CSVs in: {OCCUPANCY_DIR}")
    outdoor_files = scan_csvs(OUTDOOR_DIR)
    if outdoor_files:
        outdoor, outdoor_details = find_outdoor_reference(outdoor_files)
    elif OUTDOOR_CO2_OVERRIDE is not None:
        outdoor, outdoor_details = float(OUTDOOR_CO2_OVERRIDE), []
        print("CAUTION: using manually supplied outdoor CO2, not measured outdoor files")
    else:
        raise FileNotFoundError(f"Put REAL outdoor CO2 CSVs in {OUTDOOR_DIR} or set OUTDOOR_CO2_OVERRIDE")
    frames = [load_occupancy_file(p) for p in occ_files]
    empty_indoor, baseline_source = find_indoor_reference(frames)
    vol = np.concatenate([d.volume.to_numpy() for d in frames])
    if np.nanmax(vol) - np.nanmin(vol) > .2:
        raise ValueError("Room volumes differ. Train separate models per room or correct the CSVs")
    volume = float(np.nanmedian(vol))
    f = make_features(frames, empty_indoor, outdoor)
    if len(f.run_group.unique()) < 3:
        warnings.warn("Fewer than 3 independent run IDs: validation is only exploratory")
    if len(f.source.unique()) > len(f.run_group.unique()):
        warnings.warn("Some files share session IDs (possibly related/augmented). They are NOT independent runs")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    records = []
    best = {}
    for hybrid in (True, False):
        for alpha in RIDGE_ALPHAS:
            cv, method = cross_validate(f, alpha, hybrid)
            macro = float(cv.mae_people.mean())
            typ = "hybrid" if hybrid else "ridge_only"
            records.append({"model": typ, "alpha": alpha, "mean_fold_mae": macro, "method": method})
            if typ not in best or macro < best[typ][0]:
                best[typ] = (macro, alpha, cv)
    chosen_alpha = best["hybrid"][1]
    model = fit(f, chosen_alpha, hybrid=True)
    f["hybrid_fitted"] = predict(f, model, True)
    f["physics_estimate"] = np.clip(f.physics_people, 0, MAX_PEOPLE)
    f.to_csv(OUTPUT_DIR / "training_predictions.csv", index=False)
    pd.DataFrame(records).to_csv(OUTPUT_DIR / "model_comparison.csv", index=False)
    best["hybrid"][2].to_csv(OUTPUT_DIR / "validation_by_fold.csv", index=False)
    header = OUTPUT_DIR / "vigil_hybrid_occupancy_model.h"
    write_header(header, model, outdoor, empty_indoor, volume, chosen_alpha)

    report = {
        "input_occupancy_files": [x.name for x in occ_files],
        "input_outdoor_files": outdoor_details,
        "outdoor_reference_ppm": outdoor,
        "indoor_empty_reference_ppm": empty_indoor,
        "indoor_reference_source": baseline_source,
        "room_volume_m3": volume,
        "assumed_G_L_h_per_person": CO2_GENERATION_L_H_PERSON,
        "assumed_ACH_per_hour": VENTILATION_ACH,
        "unique_experiment_ids": int(f.run_group.nunique()),
        "samples_after_history": len(f),
        "validation_method": records[0]["method"],
        "hybrid_cv_mae_people": best["hybrid"][0],
        "ridge_only_cv_mae_people": best["ridge_only"][0],
        "selected_alpha": chosen_alpha,
        "hybrid_intercept": float(model.intercept_),
        "hybrid_coefficients": list(map(float, model.coef_)),
        "limitations": ["Model is experimental; CO2 alone does not identify occupant count uniquely",
                        "Outdoor reference is a measurement only if the inputs are genuinely outdoor",
                        "ACH and CO2 generation remain assumptions unless independently measured",
                        "If validation is leave-one-occupancy-level-out, it is NOT unseen-recording accuracy"],
    }
    (OUTPUT_DIR / "training_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print("\nVIGIL HYBRID OCCUPANCY TRAINING COMPLETE")
    print(f"Outdoor CO2: {outdoor:.1f} ppm | Indoor baseline: {empty_indoor:.1f} ppm")
    print(f"Room volume: {volume:.3f} m3 | assumed ACH: {VENTILATION_ACH} | assumed G: {CO2_GENERATION_L_H_PERSON}")
    print(f"Training samples: {len(f)}, independent IDs: {f.run_group.nunique()}")
    print(f"Validation: {report['validation_method']}")
    print(f"Hybrid MAE: {best['hybrid'][0]:.3f} people | Plain Ridge MAE: {best['ridge_only'][0]:.3f} people")
    print("Header generated:", header)
    print("WARNING: validate on new independently recorded runs before trusting occupancy counts.")


if __name__ == "__main__":
    main()

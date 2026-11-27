"""Regenerate the offline specifications and comparison data from repository inputs."""
import csv
import json
import re
from pathlib import Path
from statistics import median

import numpy as np

HERE = Path(__file__).resolve().parent
INPUT = HERE.parent / "inputs"
F = "inputs/code/VIGIL_Phase3_Fixed.ino"
H = "inputs/code/vigil_occupancy_model.h"


def write(name, value):
    (HERE / name).write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def records(name):
    with (INPUT / "data" / name).open(encoding="utf-8-sig") as stream:
        return list(csv.DictReader(stream))


def features(t, h):
    t = (t - 25) / 5
    h = (h - 75) / 10
    return np.array([t, h, t*t, h*h, t*h])


def fit_mq():
    design, target, segments = [], [], []
    for path in sorted((INPUT / "data").glob("MQ135_CleanAir_*.csv")):
        if path.stem.endswith("night_indoor"):
            continue
        boots = [[]]
        previous = None
        for row in records(path.name):
            uptime = int(row["Uptime_s"])
            if previous is not None and uptime < previous:
                boots.append([])
            previous = uptime
            boots[-1].append(row)
        for boot, rows in enumerate(boots):
            samples = [(float(r["Temp_C"]), float(r["RH_pct"]), float(r["Rs_kOhm"]))
                       for r in rows if int(r["Uptime_s"]) >= 600]
            valid = [(t,h,r) for t,h,r in samples if 20.5 <= t <= 28 and 63 <= h <= 95 and r > 0]
            info = dict(file=path.name, boot=boot, rows=len(rows), used=len(valid))
            segments.append(info)
            if not valid:
                continue
            temperatures, humidities, resistance = np.array(valid).T
            t0, h0, r0 = map(float, map(np.median, (temperatures, humidities, resistance)))
            response = np.log(r0 / resistance)
            x0 = float(np.median(response))
            info["candidate_anchor"] = dict(r0=r0, x0=x0, t0=t0, rh0=h0)
            for t,h,_ in valid:
                design.append(features(t,h) - features(t0,h0))
            target.extend(response - x0)
    beta, _, rank, _ = np.linalg.lstsq(design, target, rcond=None)
    if rank != len(beta):
        raise ValueError("Candidate design is rank deficient")
    residual = target - np.asarray(design) @ beta
    center = float(np.median(residual))
    return dict(status="reconstructed candidate only", beta=beta.round(12).tolist(),
                residual_median=round(center,12),
                residual_robust_sd=round(float(1.4826*np.median(abs(residual-center))),12),
                segments=segments)


def sharp_analysis():
    rows = records("VIGIL_Dust_Baseline_4.csv")
    window, filtered, raw = [], [], []
    previous = None
    for row in rows:
        now = int(row["time_ms"])
        if previous is not None and (now - previous > 2000 or now <= previous):
            window.clear()
        previous = now
        value = float(row["on_sensor_mv"])
        raw.append(value)
        window = (window + [value])[-30:]
        if len(window) == 30:
            filtered.append(median(window))
    def stats(values):
        center = median(values)
        return dict(n=len(values), median_mv=center,
                    robust_sd_mv=round(1.4826*median(abs(v-center) for v in values),6))
    return dict(raw=stats(raw), rolling_medians=stats(filtered))


def build():
    header = (HERE.parent / H).read_text()
    constants = {name: float(value) for name,value in re.findall(
        r"constexpr float (\w+) = ([-.\d]+)f;", header)}
    write("specs/occupancy.json", dict(name="occupancy v0",
          status="imported, not re-derived: no measured training data supplied",
          sources=[H+":9-44", F+":70-89"], parameters=constants, prototype_only=True,
          window_capacity=24, gap_reset_ms=30000, min_samples=4,
          features=["window mean CO2 minus baseline (ppm)", "least squares slope (ppm/min)"],
          display="clamp then round to nearest even count, half upward"))
    write("specs/mq135.json", dict(name="mq135 v0", status="imported firmware",
          sources=[F+":19-36", F+":92-127", F+":180-194", F+":295-299"],
          beta=[-.0978957479,.113921441,.0306626048,.0722774401,-.0166802],
          residual_median=-.0130058485, residual_scale=.0478087528, alpha=.2,
          limit=4.87158753, window=5, confirmation=3, warm_ms=600000,
          adc_age_limit_ms=1500, gap_ms=20000, temperature_range=[20.5,28],
          humidity_range=[63,95], temperature_center_scale=[25,5], humidity_center_scale=[75,10],
          terms=["t","h","t*t","h*h","t*h"], anchor=None,
          anchor_fields=["r0","x0","t0","h0"], anchor_validation="F98-109, valid and matching model_sig",
          supply_v=5.0, load_kohm=1.0, divider=2.0,
          adc_pairs=20, adc_high_range_at=3900, valid_raw_exclusive=[2,4090],
          resistance="load_kohm*(supply_v/ao_v-1); require 0 < ao_v < supply_v",
          inference="once per new valid SCD40 reading; reject reused ADC sequence",
          resets="warm-up, unaccepted baseline, stale/invalid ADC, climate outside coverage, inference gap, nonfinite score",
          response="ln(r0/rs)-x0", predicted="poly(T,RH)-poly(t0,h0)",
          score="(response-predicted-residual_median)/residual_scale",
          ewma="alpha*max(0,score)+(1-alpha)*previous; initial zero",
          alert="full window with at least confirmation values strictly above limit"))
    write("specs/sharp.json", dict(name="sharp v0",status="imported provisional",
          sources=[F+":30-31", F+":130-143", F+":149-179", F+":293"],
          signal="reconstructed ON mV", baseline_mv=1458.52, robust_sd_mv=147.585,
          low_mv=1015.76,elevated_mv=1901.28,high_mv=2048.86,median_window=30,
          reset_gap_ms=2000, persistent_high_ms=10000, stale_ms=2500,
          period_us=10000,sample_us=280,pulse_us=320,width_range_us=[300,340],
          sample_range_us=[280,300],pulses_per_aggregate=100,min_good=95,
          status_order=["invalid/stale","filter warmup","persistent high","high pending","elevated","low","baseline"],
          filter="median of valid ON aggregates; reset on invalid or gap above reset_gap_ms",
          high="ready and median >= high_mv continuously for persistent_high_ms",
          validity="zero missed periods, finite ON >= low_mv/2; good ON excludes ADC rails"))
    write("specs/forecast.json",dict(name="forecast v0",sources=[F+":28,211,332",
          "inputs/reference/test_backend.py:19-38"],horizon_minutes=10,
          persistence="latest fresh ppm",linear="max(0, occupancy window mean + horizon_minutes*slope_ppm_min)",
          robust="reconstructed median pairwise slope extrapolated from latest sample",
          historical_robust_parameters=None, historical_match_tolerance_ms=None))
    write("mq135_candidate.json", fit_mq())
    write("sharp_comparison.json", sharp_analysis())


if __name__ == "__main__":
    build()

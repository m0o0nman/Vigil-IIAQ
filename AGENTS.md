# New VIGIL: agent instructions

## Goal
Rebuild the existing VIGIL ESP32 indoor-air-quality system as a cloud-connected consumer product (KUET ECE undergraduate prototype). Work in phases and STOP after each one.

## Source of truth
ONLY the files in /inputs. Every numeric parameter (pins, timings, thresholds, coefficients, baselines, fan policy values) MUST be extracted from these files and cited by file and line. NEVER use numbers from memory. If a value is not in /inputs, STOP and report it missing. NEVER invent it.

/inputs contents:
- code/VIGIL_Phase3_Fixed.ino: old firmware (pin map, ADC and Sharp pulse timing, MQ135 betas/anchors/EWMA, Sharp thresholds, fan state machine, NVS use, telemetry fields).
- code/vigil_occupancy_model.h: original Ridge occupancy coefficients.
- code/train_vigil_occupancy_hybrid.py: reference only. The hybrid occupancy model is NOT part of this build.
- data/MQ135_CleanAir_{noon,evening,night,new,empty_room_ventilated,occupied_212_3_people,night_indoor}.csv: MQ135 clean-air logs (PC_Time, Uptime_s, CO2_ppm, Temp_C, RH_pct, ADC_raw, GPIO34_V, AO_V, Rs_kOhm, Rs_R0, R0check_kOhm).
- data/VIGIL_Dust_Baseline_4.csv: Sharp raw logs (on_sensor_mv, off_sensor_mv, delta_sensor_mv, max_pulse_us).
- data/VIGIL_CO2_occupancy_data_empty_room.csv: 79 rows, baseline and transition only.
- data/VIGIL_CO2_Occupation_test_2.csv: 924 rows, one session, labels 0/2/4/6/8, timestamps exactly 5.000 s apart from 09:00:00. PROVENANCE UNVERIFIED, possibly simulated. Treat as NOT measured until audited.
- reference/dashboard.html, reference/test_backend.py: old dashboard and backend tests. They show intended forecast behaviour (persistence, robust forecast, forecast-to-actual matching, MAE/RMSE/bias).
- brand/: README.txt, colours/ (hex tokens), fonts/ (Syne via Google Fonts CSS, OFL), logos/, audio/breathe-pink-floyd.txt (official YouTube embed URL, NO audio file).

KNOWN GAPS (Phase 0 MUST confirm each): no measured ascending-occupancy experiment, no MQ135 training script, no Sharp training script, no old backend source, no telemetry export.

## Locked architecture
- ESP32 -> HTTPS POST /api/ingest every ~5 s -> Next.js (App Router, TypeScript) on Vercel -> Firebase (RTDB live data and commands, Firestore history, model versions and calibration sessions, Firebase Auth) -> browser over the RTDB WebSocket.
- The ESP32 only senses, transmits and applies a minimal safety rule. ALL ML runs in Next.js route handlers as stateless TypeScript. Models are versioned JSON specs in Firestore (models/{name}/versions/{id} plus an "active" pointer). Python is OFFLINE only, to emit specs and golden test vectors.
- NO Cloud Functions, Firebase Storage, paid-plan features, INA219, neural networks, or hybrid occupancy model. Single owner login, one device.
- Allowed dependencies. Web: next, react, typescript, firebase, firebase-admin, vitest, recharts. Python: numpy, pandas, scikit-learn. Firmware: the libraries in the .ino plus HTTPClient, WiFiClientSecure, DNSServer, ArduinoJson. Anything else: ask first.

## Layout
/inputs (read-only), /training, /firmware, /web (Next.js app; package.json lives in /web, not at the root), /docs.

## Git rules
- NEVER modify, move or delete anything in /inputs.
- One branch per phase: phase-0, phase-1, and so on. Commit in small logical steps.
- NEVER push, merge, rebase, force-push or open a pull request unless I ask. At the end of each phase show `git status` and `git log --oneline`.
- NEVER commit secrets: .env files, Firebase service-account keys, Wi-Fi credentials, device secrets, tokens. Create .gitignore in Phase 0 (.env*, node_modules/, .next/, __pycache__/, *.pem, *serviceAccount*.json, .vercel/, firmware/build/). Keep a committed .env.example with variable NAMES only.
- If a file about to be committed looks like it holds a secret, stop and tell me.

## Approval boundaries
Ask before: deleting any file, adding a dependency not listed above, changing the Firestore/RTDB schema after Phase 3 approval, touching anything outside the repo, or running any command that installs software globally.

## Hard constraints
- Only change what the current phase requests. No extra features, auth methods or abstractions.
- Preserve the pin map and the tested acquisition timing. NEVER retune a threshold to make readings look normal.
- NEVER fabricate data, calibration values, accuracy figures or test results. Label synthetic test data as synthetic.
- Wording: NO "PM2.5", "AQI", calibrated gas or VOC claims, headcount-accuracy claims, or energy-savings claims. MQ135 is NOT CO2. Status colours are UI semantics, NOT air-quality thresholds.
- Verify current library and API details against official docs. If you cannot verify, say so.

## Phases (STOP after each and wait for "approved")

Phase 0, inspect only, write no code. Create /docs/phase0_report.md and .gitignore containing:
(a) per-file inventory with schemas and row counts;
(b) table of every constant extracted from the .ino and the .h, with line numbers;
(c) how the old firmware computes MQ135 (R0, x0, T0, RH0, residual, EWMA, vote), Sharp, occupancy and the fan policy, plus the exact pin map and Sharp pulse code to preserve;
(d) dataset audit: time span, sampling interval, ranges, anomalies. For test_2, give evidence for or against it being measured (timestamp regularity, value granularity, smoothness, physical plausibility). Say "unverified" if inconclusive;
(e) recomputed Sharp stats from VIGIL_Dust_Baseline_4.csv (median and 1.4826*MAD of on_sensor_mv, whole file and stable windows) against the .ino constants. Report any difference. NEVER adjust a threshold to hide it;
(f) gaps and contradictions;
(g) whether the .ino contains the 12 fan-policy self-tests, and what they cover.

Phase 1, offline training and specs (/training):
- Occupancy: import Ridge coefficients from vigil_occupancy_model.h as spec "occupancy v0", labelled "imported, not re-derived: no measured training data supplied". NEVER retrain from test_2. If Phase 0 shows test_2 is measured, report it and ask me.
- MQ135: rebuild the normal-response regression from the clean-air CSVs using the .ino's feature definitions and session-anchor method. Exclude night_indoor and say why. Compare with the .ino constants. Ship the .ino values unless I approve the refit.
- Sharp: build the baseline spec from VIGIL_Dust_Baseline_4.csv using the .ino method (rolling median, MAD robust SD, thresholds, persistence). Report against the .ino constants. Ask which to ship if they differ by more than 1%.
- Forecast spec: persistence, linear and robust-slope parameters from the .ino and reference/test_backend.py. Reproduce test_backend.py's expected numbers as unit tests.
- Emit JSON specs, golden vectors (synthetic ones labelled) and a comparison report.

Phase 2, firmware v2 (/firmware):
- Keep pin map, ADC handling, SCD40, MQ135 and timed Sharp pulse acquisition unchanged in behaviour. Keep Sharp pulses isolated from network calls.
- Remove ML, forecasting, the AP and the HTTP server. Add Wi-Fi station mode with captive-portal provisioning (portal only when no saved credentials or connection fails).
- HTTPS POST of JSON every ~5 s with a device-secret header: CO2, T, RH, MQ135 ADC/voltage/Rs, Sharp ON/OFF/delta/max pulse, validity flags, sequence number, uptime.
- Parse the response {mode, fan_cmd, fan_seconds}. Apply a minimal local safety rule using the CO2 ON threshold and stale-CO2 OFF timeout from the .ino. The safety rule ALWAYS overrides backend commands.
- RAM ring buffer: queue during outages and upload with sequence numbers after reconnect.
- Adapt the existing self-tests to the reduced rule.
- Compile with arduino-cli if available, otherwise give exact Arduino IDE steps. Report what was not hardware-tested.

Phase 3, backend (/web):
- Routes: /api/ingest, /api/command, /api/calibrate/{start,status,abort}, /api/model/rollback, /api/export/[session].
- TypeScript model runtime that loads active specs and passes ALL golden vectors in an automated vitest run.
- RTDB: /live/latest, /state/mode, /buffer (rolling ~5 min), /command. Firestore: history batched as ONE document per minute, calibration sessions (columns matching the old CSV headers of that sensor), model versions, forecasts, matched forecast metrics (matched origins only).
- Owner-only writes via Firebase Auth, with security rules written.

Phase 4, calibration:
- Calibrate -> mode "calibrating" -> warm-up -> stable window -> quality gate (CO2 flat, noise within ranges derived from the CSVs, enough samples, no large gaps, baseline not wildly different from the previous version).
- Pass: new active version. MQ135 re-anchors only (no beta refit). Sharp gets a new baseline and MAD. The occupancy CO2 baseline updates, with a visible note that occupancy is approximate after recalibration.
- Fail: keep the old version, return a friendly reason. Include "Restore previous calibration".
- Record every gate threshold as PROVISIONAL, with its data source. Flag a Sharp baseline far from the Baseline 4 data.

Phase 5, UI (/web):
- Branding ONLY from /inputs/brand: copy logos to web/public/brand, use Syne via next/font/google (weights 400-800, sans-serif fallback), colour tokens from colours.json in ONE theme file. Light ivory theme only. logo-forest.svg on ivory, logo.svg or logo-sage.svg on deep forest. Never use light sage or terracotta as small text.
- Start screen: "Calibrate" and "Breathe" buttons.
- Breathe works uncalibrated: CO2, occupancy, forecast, fan run. Gas and dust show "Needs calibration" or "Warming up".
- Landing: one status word + colour + icon (Fresh / OK / Stuffy / Poor, from one editable CO2-band config based on the .ino fan values), one plain sentence, tiles for people ("about N", even-rounded), comfort (temperature + Dry/Comfortable/Humid), "Fumes" and "Dust" Normal/Elevated badges, fan status with reason, and a "See details" button.
- Fan controls: Auto / Off / Freshen now.
- Details page: raw values, history charts, forecast MAE/RMSE/bias, model versions, calibration history, CSV export.
- Pink Floyd homage: breathing-orb animation, prism-spectrum motif, short ORIGINAL calming prompts. Calibrate screen shows the youtube-nocookie embed from brand/audio/breathe-pink-floyd.txt, played only when the user taps it. No autoplay, audio files or lyrics. Text fallback if the embed fails. State that the embed is not live-tested.

Phase 6, docs: README with Windows PowerShell setup, Firebase and Vercel steps (Root Directory = web), a wiring and pin table from the .ino, a test checklist separating "tested in software" from "needs hardware or experiment", and a note that the logo symbol comes from a third-party reference (check permission before public use).

## Done criteria (every phase)
Report: files created or changed, exact commands run with real pass/fail output, golden-vector results (Phase 3), anything unverified, next phase. Claims of success MUST cite command output. NEVER claim hardware, Wi-Fi, YouTube or Vercel behaviour as tested unless run. Then STOP.
# VIGIL-IIAQ · Phase 0 engineering audit

**Decision.** The checkout supports importing the original occupancy Ridge and writing parity fixtures after approval. It does not establish a measured occupancy training experiment, a reproducible MQ anchor fit, or a unique Sharp calibration window. Preserve the embedded reference values pending decisions below. No model fitting or device operation took place.

## Evidence and scope

The inventory below covers every regular file and its parent directories. Paths are relative to inputs/. The nested inputs/ directory mirrors brand/, code/, data/ and reference/ byte for byte. Count each log once. AGENTS.md matches the root instructions. Source references F and H denote code/VIGIL_Phase3_Fixed.ino and code/vigil_occupancy_model.h respectively. CSV statistics use the complete data lines below each file's header.

## Acquisition and model behavior

* **SCD40 and occupancy.** The firmware starts periodic measurement over I²C, polls the ready bit, rejects zero CO₂, nonfinite climate values and out-of-range humidity, and ages control independently of display validity (F285–291, 298, 342–345). Each accepted reading enters the bounded history. Mean CO₂ minus the historical empty baseline and least-squares slope in ppm/min feed the scaled Ridge in H32–44. Clip before rounding to the nearest even display value. Flag excursions from the training feature domain and reset on a long gap (F70–89). The CSV rate field uses ppm/hour. Room transfer, ventilation and the empty baseline affect interpretation. The hybrid Python script uses NumPy, pandas and scikit-learn and is reference only.
* **MQ135.** The ADC worker averages raw and millivolt reads, retries at higher attenuation on saturation, reconstructs AO through the divider and derives Rs from the load resistor and supply. It discards the first conversion after changing attenuation (F153–154,180–194). NVS supplies R0, x0, T0 and RH0. Acceptance requires a valid flag, matching float-bit model signature, finite positive R0, finite x0 and climate coverage. No anchor acquisition or fitting procedure survives in this sketch. On each fresh SCD40 measurement compute log(R0/Rs) − x0, subtract the difference of the quadratic climate polynomial between current and anchor conditions, robust-standardize, and feed the positive part into the EWMA. An alert requires a full vote ring. Warm-up, stale or repeated ADC data, bad scores and coverage failures reset the detector (F92–127). Preserve the anchors or collect verified new ones. A zero logged Rs/R0 cannot be used to recover R0.
* **Sharp.** Preserve calibrated reconstructed LED-ON millivolts, the independent OFF diagnostic and their difference. OFF can be unavailable while ON is valid. A single ADC worker owns both channels. Between pulses it schedules MQ acquisition only when sufficient time remains. Apply per-pulse rail and timing rejection, aggregate accepted conversions, then require enough good pulses and no missed periods. Median-filter valid aggregates, clear history on a gap or invalid aggregate, and time continuous high response separately from an elevated or pending indication (F130–198,293). Preserve active-HIGH timing and calibration order. Carrying only the latest aggregate every five seconds would lose the original filter cadence and persistence evidence. Resolve batching of timestamped aggregates before the port.
* **Fan.** GPIO is active HIGH and boots OFF. USB selects standby, supervised timed test, or AUTO. AUTO suspends immediately on stale CO₂. Fresh CO₂ at the start threshold starts the fan. Preventive start needs consecutive distinct qualifying readings (floor, rising slope and forecast threshold together). Repeated polls add no votes. Once on, enforce minimum runtime and continuous recovery strictly below the release threshold. A rebound cancels recovery. A gap clears votes and recovery. Use unsigned elapsed time. Gas, dust and occupancy provide context only. No outdoor reference or rated fan power is supplied (F20–29,204–251,277–282,298–336). Later firmware must preserve the local high-CO₂ and stale-data overrides through outages and manual commands.
* **Forecasts.** Persistence holds the origin reading. Local linear extrapolation uses the window mean and slope, floored at zero (F210–213,332). reference/test_backend.py lines 17–46 exercise duplicate fresh samples, robust linear input, paired errors, stale readings, reboots, missed targets, disconnect, export and invalid schema. The ramp expects 780 ppm and paired MAE of zero for robust versus 120 ppm for persistence. Fixtures constrain examples but do not uniquely identify the robust estimator, matching tolerance or gap handling. Do not infer those parameters from a passing ramp.
* **Telemetry.** The legacy AP exposes read-only HTTP and serial JSON (F318–356). Nonfinite numbers become null. Distinguish device uptime, sample age, validity, readiness, current actuator state and accumulated runtime. The exact field list follows below. The device does not export the raw MQ ADC mean, boot identity or an upload sequence in this payload. Those are future protocol requirements. Never treat a stale sample as a new observation.

## Architecture, operations and security

The proposed split is technically plausible: device-initiated HTTPS to a short-lived Next.js App Router handler, offline Python for specs and fixtures, Firebase Admin in server-only Node.js handlers, and a directly authenticated browser subscription to RTDB. Route handlers cannot rely on warm process memory. Persist ordered history, detector state, forecast origins, model versions and command acknowledgments. Use atomic updates or transactions for concurrent requests. Snapshot active versions per calculation. Deduplicate by device, boot/session and sequence; retain original capture times through reconnects. Buffered historical uploads must never replay expired actuator commands. Return commands in ingest responses; an offline device cannot receive a new cloud command.

At the nominal cadence in inputs/AGENTS.md (locked architecture and Phase 3), one continuously running device generates about 17,280 ingest requests/day or 518,400 per 30 days. One completed history document per minute is 1,440/day. Updating that document on every sample still incurs a write per update. Budget separate model reads, forecasts, calibration writes, reconnect bursts, browser bandwidth and storage retention. Confirm current plan limits and noncommercial eligibility before committing to continuous operation. No billing account, project region, database rules, quota measurements or deployed endpoint were verified.

Official documentation checks returned HTTP 403 for the [Firestore quota table](https://firebase.google.com/docs/firestore/quotas), [RTDB limits](https://firebase.google.com/docs/database/usage/limits), [Vercel Hobby plan](https://vercel.com/docs/plans/hobby) and [function limits](https://vercel.com/docs/functions/limitations), including a retry. Current numerical allowances and SDK/core compatibility remain unverified. Deploy later with Vercel root web/, server credentials scoped to this project, Firebase Auth and explicit owner UID checks. Browser rules must deny unauthenticated and other-user access. Admin SDK operations require independent authorization in the handler. Separate device ingest authorization from owner commands, calibration, export and rollback. Validate size, schema, finite ranges, age and replay before writing. Protect device-secret headers, rotate secrets, validate TLS and bound local queue and retry behavior. Physical access to flash and captive-portal provisioning are separate trust boundaries.

F4 and F347 contain a fixed development AP credential in tracked history. Treat it as disclosed and replace it before reuse. HTTP telemetry exposes occupancy/activity on that network. The firmware exposes no network actuator endpoint. Ignore rules protect future untracked files only. Protect service-account material and Wi-Fi/device credentials from client bundles, logs and exports. No credentials or backend were provisioned in this audit.

## Branding and reference UI

The source kit provides white, forest and sage traces and transparent 1706×2048 PNG fallbacks, a scalable favicon, a 192×192 PNG and multi-resolution ICO. Use forest on ivory, white or sage on forest. The traces approximate third-party artwork; clearance and an original vector master are missing. The colour JSON, TXT and CSS define ivory #F5F4EC, pale moss #DDE2C8, forest #303D2B and primary accent **#B2BD7E**. Preserve the 60% ivory, 30% combined sage/moss and 10% forest allocation. Fresh #6E916B, OK #B2BD7E, Stuffy #C3A15E and Poor #B66D5E require text/icons; avoid light accent colours for small text. See brand/colours/colours.txt lines 3–15.

Use Syne, weights 400–800, with sans-serif fallback. The CSS points to Google Fonts and the kit includes OFL text, with no font binaries. Verify build-time font access. The dark polling dashboard documents stale/offline states, history, forecasts and matched MAE/RMSE/bias. Its endpoints depend on the missing Python backend; retain its semantics in the later light UI. The audio TXT supplies the privacy-enhanced embed for video jcz0YxYl6Ac. Load on user action, provide text fallback, and retain the no-autoplay design. Playback, visual rendering and permission for public logo use remain unverified.

## Decisions and implementation order

1. Obtain original logging notes, measured ascending/descending occupancy trials, synchronized stage labels, original Ridge fit provenance, MQ training/anchor procedure, Sharp window definition, and robust forecast/matching implementation if available. No original MQ or Sharp training script, legacy backend module, exported telemetry stream or hardware validation harness is supplied. The hybrid trainer cannot fill those gaps.
2. After Phase 1 approval import occupancy v0 as “imported, not re-derived: no measured training data supplied”. Compare MQ and Sharp offline against the firmware, keep synthetic fixtures labelled, separate sessions before evaluation and avoid leakage from overlapping windows. Confirm anchor and robust-forecast conventions before claiming parity. Obtain the owner's Sharp baseline decision before shipping. An independent experiment is required for accuracy claims.
3. Later sequence: device acquisition and offline safety; authenticated ingest with model parity, live state and minute history; calibrated version updates and rollback; branded owner UI; deployment and hardware verification documentation. Pin compatible ESP32 Arduino, Sensirion and legacy ADC APIs and verify on the actual board. Separate software checks from timing, sensor, electrical, fan, Wi-Fi and cloud tests.

## Inventory

Each “also” path is a separately verified identical file. Sizes are bytes.

| Path | Bytes | Also under inputs/ |
|---|---:|---|
| AGENTS.md | 11054 | — |
| brand/README.txt | 1232 | inputs/brand/README.txt |
| brand/audio/breathe-pink-floyd.txt | 693 | inputs/brand/audio/breathe-pink-floyd.txt |
| brand/colours/colours.css | 202 | inputs/brand/colours/colours.css |
| brand/colours/colours.json | 211 | inputs/brand/colours/colours.json |
| brand/colours/colours.txt | 623 | inputs/brand/colours/colours.txt |
| brand/fonts/OFL.txt | 4402 | inputs/brand/fonts/OFL.txt |
| brand/fonts/fonts.css | 133 | inputs/brand/fonts/fonts.css |
| brand/fonts/fonts.txt | 605 | inputs/brand/fonts/fonts.txt |
| brand/logos/favicon-192.png | 22377 | inputs/brand/logos/favicon-192.png |
| brand/logos/favicon.ico | 12836 | inputs/brand/logos/favicon.ico |
| brand/logos/favicon.svg | 9389 | inputs/brand/logos/favicon.svg |
| brand/logos/logo-forest.png | 153685 | inputs/brand/logos/logo-forest.png |
| brand/logos/logo-forest.svg | 9337 | inputs/brand/logos/logo-forest.svg |
| brand/logos/logo-sage.png | 155139 | inputs/brand/logos/logo-sage.png |
| brand/logos/logo-sage.svg | 9337 | inputs/brand/logos/logo-sage.svg |
| brand/logos/logo.png | 121985 | inputs/brand/logos/logo.png |
| brand/logos/logo.svg | 9337 | inputs/brand/logos/logo.svg |
| code/VIGIL_Phase3_Fixed.ino | 24840 | inputs/code/VIGIL_Phase3_Fixed.ino |
| code/train_vigil_occupancy_hybrid.py | 17614 | inputs/code/train_vigil_occupancy_hybrid.py |
| code/vigil_occupancy_model.h | 1145 | inputs/code/vigil_occupancy_model.h |
| data/MQ135_CleanAir_empty_room_ventilated.csv | 90168 | inputs/data/MQ135_CleanAir_empty_room_ventilated.csv |
| data/MQ135_CleanAir_evening.csv | 23613 | inputs/data/MQ135_CleanAir_evening.csv |
| data/MQ135_CleanAir_new.csv | 31398 | inputs/data/MQ135_CleanAir_new.csv |
| data/MQ135_CleanAir_night.csv | 31828 | inputs/data/MQ135_CleanAir_night.csv |
| data/MQ135_CleanAir_night_indoor.csv | 11533 | inputs/data/MQ135_CleanAir_night_indoor.csv |
| data/MQ135_CleanAir_noon.csv | 29789 | inputs/data/MQ135_CleanAir_noon.csv |
| data/MQ135_CleanAir_occupied_212_3_people.csv | 91715 | inputs/data/MQ135_CleanAir_occupied_212_3_people.csv |
| data/VIGIL_CO2_Occupation_test_2.csv | 154866 | inputs/data/VIGIL_CO2_Occupation_test_2.csv |
| data/VIGIL_CO2_occupancy_data_empty_room.csv | 12987 | inputs/data/VIGIL_CO2_occupancy_data_empty_room.csv |
| data/VIGIL_Dust_Baseline_4.csv | 372353 | inputs/data/VIGIL_Dust_Baseline_4.csv |
| reference/dashboard.html | 24074 | inputs/reference/dashboard.html |
| reference/test_backend.py | 2649 | inputs/reference/test_backend.py |

## Dataset measurements

Ranges below use nonblank numeric cells. Δt is successive host timestamp difference in file order. A filename identifies a purported session condition only. Independent capture records and reference instruments are absent.

### MQ135_CleanAir_empty_room_ventilated.csv

993 records (lines 2–994). From 2026-11-20T12:48:06.253+06:00 to 2026-11-20T14:28:05.194+06:00. Δt min/median/max 4.551/4.817/1333.78 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 6 … 4431 | 0 |
| CO2_ppm | 438 … 597 | 0 |
| Temp_C | 24.68 … 26.11 | 0 |
| RH_pct | 75.11 … 86.27 | 0 |
| ADC_raw | 105 … 680 | 0 |
| GPIO34_V | 0.2262 … 0.6842 | 0 |
| AO_V | 0.4524 … 1.3684 | 0 |
| Rs_kOhm | 2.6539 … 10.0522 | 0 |
| Rs_R0 | 0 … 0 | 0 |
| R0check_kOhm | 4.6923 … 17.8184 | 0 |

Candidate normal-response data only. Device uptime decreases 1 time(s); segment at any reboot and recheck warm-up and anchor validity.

### MQ135_CleanAir_evening.csv

256 records (lines 2–257). From 2026-11-18T18:19:43.210+06:00 to 2026-11-18T18:41:53.793+06:00. Δt min/median/max 5.201/5.218/5.234 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 784 … 2114 | 0 |
| CO2_ppm | 439 … 453 | 0 |
| Temp_C | 23.06 … 24.1 | 0 |
| RH_pct | 76.02 … 78.42 | 0 |
| ADC_raw | 95 … 125 | 0 |
| GPIO34_V | 0.2233 … 0.2473 | 0 |
| AO_V | 0.4466 … 0.4945 | 0 |
| Rs_kOhm | 9.1112 … 10.1957 | 0 |
| Rs_R0 | 0.33731 … 0.37746 | 0 |
| R0check_kOhm | 14.7305 … 16.6178 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.

### MQ135_CleanAir_new.csv

344 records (lines 2–345). From 2026-11-22T02:57:09.516+06:00 to 2026-11-22T03:27:03.101+06:00. Δt min/median/max 4.554/4.818/18.793 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 2416 … 4209 | 0 |
| CO2_ppm | 452 … 483 | 0 |
| Temp_C | 22.94 … 23.56 | 0 |
| RH_pct | 91.5 … 94.02 | 0 |
| ADC_raw | 790 … 1103 | 0 |
| GPIO34_V | 0.7613 … 1.0231 | 0 |
| AO_V | 1.5227 … 2.0463 | 0 |
| Rs_kOhm | 1.4434 … 2.2836 | 0 |
| Rs_R0 | 0 … 0 | 0 |
| R0check_kOhm | 2.3953 … 3.778 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.

### MQ135_CleanAir_night.csv

345 records (lines 2–346). From 2026-11-19T02:19:40.038+06:00 to 2026-11-19T02:49:35.061+06:00. Δt min/median/max 5.191/5.218/5.232 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 1895 … 3690 | 0 |
| CO2_ppm | 447 … 466 | 0 |
| Temp_C | 21.01 … 21.97 | 0 |
| RH_pct | 85.95 … 87.86 | 0 |
| ADC_raw | 206 … 255 | 0 |
| GPIO34_V | 0.3066 … 0.3352 | 0 |
| AO_V | 0.6132 … 0.6704 | 0 |
| Rs_kOhm | 6.4582 … 7.1539 | 0 |
| Rs_R0 | 0.23909 … 0.26485 | 0 |
| R0check_kOhm | 10.6097 … 11.6974 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.

### MQ135_CleanAir_night_indoor.csv

127 records (lines 2–128). From 2026-11-20T02:09:32.147+06:00 to 2026-11-20T02:19:30.042+06:00. Δt min/median/max 4.554/4.818/9.41 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 199 … 797 | 0 |
| CO2_ppm | 606 … 634 | 0 |
| Temp_C | 24.8 … 26.22 | 0 |
| RH_pct | 83.28 … 86.37 | 0 |
| ADC_raw | 528 … 2573 | 0 |
| GPIO34_V | 0.5492 … 2.1998 | 0 |
| AO_V | 1.0983 … 4.3996 | 0 |
| Rs_kOhm | 0.1365 … 3.5525 | 0 |
| Rs_R0 | 0 … 0 | 0 |
| R0check_kOhm | 0.2488 … 6.4535 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.
Exclude this session from normal fitting per inputs/AGENTS.md Phase 1. Its short duration, early uptime and wide resistance excursion make a settled clean-air reference uncertain. A physical cause is unverified.

### MQ135_CleanAir_noon.csv

331 records (lines 2–332). From 2026-11-18T14:14:03.533+06:00 to 2026-11-18T14:42:45.491+06:00. Δt min/median/max 5.204/5.218/5.235 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 90 … 1812 | 0 |
| CO2_ppm | 417 … 451 | 0 |
| Temp_C | 24.53 … 27.43 | 0 |
| RH_pct | 63.36 … 69.58 | 0 |
| ADC_raw | 341 … 387 | 0 |
| GPIO34_V | 0.4131 … 0.4538 | 0 |
| AO_V | 0.8262 … 0.9075 | 0 |
| Rs_kOhm | 4.5096 … 5.0518 | 0 |
| Rs_R0 | 0.16695 … 0.18702 | 0 |
| R0check_kOhm | 7.3176 … 8.0933 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.

### MQ135_CleanAir_occupied_212_3_people.csv

1009 records (lines 2–1010). From 2026-11-20T14:50:53.929+06:00 to 2026-11-20T16:09:59.138+06:00. Δt min/median/max 4.552/4.816/4.848 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| PC_Time | timestamp range above | 0 |
| Uptime_s | 100 … 4845 | 0 |
| CO2_ppm | 541 … 688 | 0 |
| Temp_C | 25.41 … 26.6 | 0 |
| RH_pct | 77.74 … 81.63 | 0 |
| ADC_raw | 478 … 695 | 0 |
| GPIO34_V | 0.5275 … 0.691 | 0 |
| AO_V | 1.0549 … 1.3819 | 0 |
| Rs_kOhm | 2.6182 … 3.7398 | 0 |
| Rs_R0 | 0 … 0 | 0 |
| R0check_kOhm | 4.8341 … 6.6793 | 0 |

Candidate normal-response data only. Device uptime decreases 0 time(s); segment at any reboot and recheck warm-up and anchor validity.

### VIGIL_CO2_Occupation_test_2.csv

924 records (lines 2–925). From 2026-11-25T09:00:00.000000+06:00 to 2026-11-25T10:16:55.000000+06:00. Δt min/median/max 5/5/5 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| pc_timestamp_local | timestamp range above | 0 |
| session_id | VIGIL_20261125_090000_0to8to0 | 0 |
| device_sequence | 4 … 927 | 0 |
| device_uptime_ms | 20180 … 4.63518e+06 | 0 |
| phase | BASELINE, OCCUPIED, TRANSITION | 0 |
| stage_id | 0 … 8 | 0 |
| ground_truth_people | 0 … 8 | 0 |
| training_eligible | 0 … 1 | 0 |
| stage_elapsed_s | 0 … 1195 | 0 |
| room_length_ft | 22 … 22 | 0 |
| room_width_ft | 7 … 7 | 0 |
| room_height_ft | 10 … 10 | 0 |
| room_volume_m3 | 43.6079 … 43.6079 | 0 |
| scd40_co2_ppm | 502 … 1298 | 0 |
| scd40_temp_c | 29.14 … 29.81 | 0 |
| scd40_rh_pct | 76.38 … 80.04 | 0 |
| mq135_adc_raw | 200 … 247 | 0 |
| mq135_gpio34_v | 0.287 … 0.357 | 0 |
| mq135_ao_v | 0.5741 … 0.714 | 0 |
| mq135_rs_kohm | 6.0032 … 7.71 | 0 |
| mq135_valid | 1 … 1 | 0 |
| empty_baseline_co2_ppm | 505 … 505 | 96 |
| co2_delta_from_baseline_ppm | -3 … 793 | 96 |
| co2_rate_ppm_per_hour | -1246.2 … 2575.4 | 2 |

All 923 intervals equal 5.0 s. CO₂ is integer ppm, with successive changes -5 … 7 ppm and median absolute change 1 ppm. Climate is printed to hundredths. Equal occupied blocks and smooth accumulation followed by delayed decay are physically plausible, but exact host timing and a scripted-looking stage schedule weaken provenance. One session, no independent people count or raw logger record. **Unverified, possibly simulated. Exclude from fitting and accuracy validation.**

### VIGIL_CO2_occupancy_data_empty_room.csv

79 records (lines 2–80). From 2026-11-23T17:15:05.7221159+06:00 to 2026-11-23T17:21:27.1221644+06:00. Δt min/median/max 4.5613/4.57866/9.50387 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| pc_timestamp_local | timestamp range above | 0 |
| session_id | VIGIL_20261123_171503_ba0da3 | 0 |
| device_sequence | 4 … 85 | 0 |
| device_uptime_ms | 20180 … 401596 | 0 |
| phase | BASELINE, TRANSITION | 0 |
| stage_id | 0 … 0 | 0 |
| ground_truth_people | 0 … 0 | 18 |
| training_eligible | 0 … 1 | 0 |
| stage_elapsed_s | 0 … 296 | 0 |
| room_length_ft | 22 … 22 | 0 |
| room_width_ft | 7 … 7 | 0 |
| room_height_ft | 10 … 10 | 0 |
| room_volume_m3 | 43.6079 … 43.6079 | 0 |
| scd40_co2_ppm | 492 … 533 | 0 |
| scd40_temp_c | 28.92 … 30.58 | 0 |
| scd40_rh_pct | 74.44 … 83.52 | 0 |
| mq135_adc_raw | 174 … 286 | 0 |
| mq135_gpio34_v | 0.2799 … 0.3711 | 0 |
| mq135_ao_v | 0.5598 … 0.7421 | 0 |
| mq135_rs_kohm | 5.7374 … 7.9326 | 0 |
| mq135_valid | 1 … 1 | 0 |
| empty_baseline_co2_ppm | 511 … 511 | 61 |
| co2_delta_from_baseline_ppm | -19 … -9 | 61 |
| co2_rate_ppm_per_hour | -2432.5 … 230.1 | 2 |

Baseline and unlabeled transition only. No occupied-stage training examples.

### VIGIL_Dust_Baseline_4.csv

3586 records (lines 2–3587). From 2026-11-25T14:18:58.1626881+06:00 to 2026-11-25T15:18:57.9325483+06:00. Δt min/median/max 0.979436/1.00411/1.02807 s. Duplicate full records: 0.

| Field (header order) | Range or categories | Blank |
|---|---|---:|
| timestamp_iso | timestamp range above | 0 |
| elapsed_s | 0.007 … 3599.78 | 0 |
| time_ms | 1.26011e+07 … 1.62009e+07 | 0 |
| samples | 100 … 100 | 0 |
| on_raw_mean | 558.56 … 1361.03 | 0 |
| on_raw_min | 334 … 993 | 0 |
| on_raw_max | 605 … 2922 | 0 |
| off_raw_mean | 0 … 0 | 0 |
| off_raw_min | 0 … 0 | 0 |
| off_raw_max | 0 … 0 | 0 |
| on_adc_mv | 586.3 … 1224.46 | 0 |
| off_adc_mv | — | 3586 |
| on_sensor_mv | 1172.6 … 2448.93 | 0 |
| off_sensor_mv | — | 3586 |
| delta_sensor_mv | — | 3586 |
| max_pulse_us | 325 … 336 | 0 |
| rail_samples | 0 … 1 | 0 |

### Sharp sensitivity to window selection

Raw ON mV. Fixed elapsed-time intervals after the opening transient are candidate steady windows; no operator-certified stable interval exists. Spread = 1.4826 × median absolute deviation from the interval median. Compare directly to F31.

| Elapsed seconds | n | Median mV | Spread mV | Median difference | Spread difference |
|---|---:|---:|---:|---:|---:|
| Entire file | 3586 | 1498.29 | 192.782 | +2.73% | +30.62% |
| 600–1200 | 598 | 1556.54 | 68.541 | +6.72% | -53.56% |
| 1800–2400 | 598 | 1346.51 | 68.081 | -7.68% | -53.87% |
| 3000–3600 | 598 | 1640.45 | 45.012 | +12.47% | -69.50% |

Window medians drift and within-window spread is smaller. Whole-file differences exceed the Phase 1 decision threshold. No evidence identifies the exact original fitting interval. Preserve F31 pending owner choice. OFF/delta missingness cannot be repaired by substituting zero.

## Firmware constants and inline literals

Declarations are transcribed verbatim. For inline literals the surrounding expression preserves units, comparisons, ordering, initialization and test context. Credentials and unrelated string payloads are omitted.

| Source line | Declaration or expression |
|---|---|
| F18 | `constexpr int SDA_PIN=21,SCL_PIN=22,MQ_PIN=34,DUST_PIN=35,LED_PIN=27,FAN_PIN=25;` |
| F19 | `constexpr float MQ_VCC=5.0f, MQ_RL=1.0f, DIVIDER=2.0f;` |
| F21 | `constexpr float FAN_RATED_W=NAN;` |
| F22 | `constexpr uint32_t MQ_WARM_MS=600000UL, MQ_GAP_MS=20000UL;` |
| F23 | `constexpr uint32_t FAN_TEST_MS=10000UL;` |
| F25 | `constexpr uint16_t CO2_ON=1000, CO2_OFF=750, PREVENTIVE_FLOOR=850;` |
| F26 | `constexpr uint32_t FAN_MIN_ON_MS=120000UL, RECOVERY_MS=180000UL;` |
| F27 | `constexpr uint32_t CONTROL_FRESH_MS=15000UL;` |
| F28 | `constexpr float FORECAST_MIN=10.0f, PREVENTIVE_RATE=5.0f;` |
| F29 | `constexpr uint8_t PREVENTIVE_VOTES=3;` |
| F30 | `constexpr uint32_t DUST_PERIOD_US=10000, DUST_SAMPLE_US=280, DUST_PULSE_US=320;` |
| F31 | `constexpr float DUST_BASE=1458.52f,DUST_SD=147.585f,DUST_LOW=1015.76f,DUST_ELEV=1901.28f,DUST_HIGH=2048.86f;` |
| F32 | `constexpr float OCC_BASE=511.0f;` |
| F33 | `constexpr float MQ_BETA[5]={-0.0978957479f,0.113921441f,0.0306626048f,0.0722774401f,-0.0166802f};` |
| F34 | `constexpr float MQ_MED=-0.0130058485f,MQ_SCALE=0.0478087528f,MQ_ALPHA=.2f,MQ_LIMIT=4.87158753f;` |
| F36 | `constexpr float T_MIN=20.5f,T_MAX=28.0f,RH_MIN=63.0f,RH_MAX=95.0f;` |
| F37 | `SensirionI2cScd4x scd40;` |
| F38 | `WebServer server(80);` |
| F42 | `uint32_t bootMs=0,lastPoll=0,lastReport=0,lastSCD=0;` |
| F44 | `uint16_t co2=0;float temp=NAN,rh=NAN;` |
| F47 | `struct MQReading {uint32_t seq,at;float pinV,aoV,rs;bool valid;};` |
| F48 | `struct DustReading {uint32_t seq,at;float on,off,delta,filtered,z;uint16_t rejected,missed,minPulse,maxPulse,history;bool valid,ready,high;};` |
| F51 | `uint32_t now, sampleAt;` |
| F53 | `uint16_t ppm;` |
| F58 | `uint32_t onAt=0, recoveryAt=0, lastSample=0;` |
| F59 | `uint8_t forecastVotes=0;` |
| F64 | `PolicyInput livePolicyInput(uint32_t now);` |
| F67 | `MQReading mqShared={0,0,NAN,NAN,NAN,false},mq={0,0,NAN,NAN,NAN,false};` |
| F68 | `DustReading dustShared={0,0,NAN,NAN,NAN,NAN,NAN,0,0,0,0,0,false,false,false},dust=dustShared;` |
| F71 | `uint32_t occTimes[24];float occValues[24];uint8_t occN=0;` |
| F72 | `float occMean=NAN,occDelta=NAN,occSlope=NAN,occEstimate=NAN;int occEven=-1;` |
| F74 | `void clearOcc(){occN=0;occMean=occDelta=occSlope=occEstimate=NAN;occEven=-1;occReady=occOut=false;}` |
| F75 | `void popOcc(){if(!occN)return;for(int i=1;i<occN;i++){occTimes[i-1]=occTimes[i];occValues[i-1]=occValues[i];}--occN;}` |
| F76 | `void updateOcc(uint32_t now,float c){` |
| F77 | `if(occN && now-occTimes[occN-1]>30000UL)clearOcc();` |
| F78 | `if(occN==24)popOcc();occTimes[occN]=now;occValues[occN++]=c;` |
| F79 | `while(occN>1 && now-occTimes[0]>60000UL)popOcc();` |
| F80 | `float sum=0,ts=0;for(int i=0;i<occN;i++){sum+=occValues[i];ts+=(occTimes[i]-occTimes[0])/1000.0f;}` |
| F82 | `occReady=occOut=false;occSlope=occEstimate=NAN;occEven=-1;` |
| F83 | `if(occN<4 \|\| now-occTimes[0]<50000UL)return;` |
| F84 | `float mt=ts/occN;double a=0,b=0;` |
| F85 | `for(int i=0;i<occN;i++){float dt=(occTimes[i]-occTimes[0])/1000.0f-mt;a+=dt*(occValues[i]-occMean);b+=dt*dt;}` |
| F86 | `if(b<=0)return;occSlope=60.0*a/b;` |
| F87 | `occOut=occDelta<-11.61538462f\|\|occDelta>391.1f\|\|occSlope<-138.7419172f\|\|occSlope>28.51248862f;` |
| F88 | `float raw=3.176339566f+3.276897848f*(occDelta/100.0f)+0.8872977638f*(occSlope/10.0f);` |
| F89 | `occEstimate=fminf(16.0f,fmaxf(0.0f,raw));occEven=2*(int)roundf(occEstimate/2.0f);occReady=true;` |
| F94 | `float mqX=NAN,mqY=NAN,mqResidual=NAN,mqZ=NAN,mqEWMA=0;` |
| F95 | `bool votes[5]={};uint8_t voteN=0,votePos=0,votePositive=0;` |
| F96 | `bool mqAlert=false;uint32_t lastMQInference=0,lastMQUsedSeq=0;` |
| F98 | `uint32_t hashFloat(uint32_t h,float v){uint32_t b;memcpy(&b,&v,4);return (h^b)*16777619UL;}` |
| F99 | `uint32_t modelHash(){uint32_t h=2166136261UL;for(int i=0;i<5;i++)h=hashFloat(h,MQ_BETA[i]);h=hashFloat(h,MQ_MED);h=hashFloat(h,MQ_SCALE);h=hashFloat(h,MQ_ALPHA);return hashFloat(h,MQ_LIMIT);}` |
| F103 | `bool valid=prefs.getBool("…",false);uint32_t sig=prefs.getUInt("…",0);` |
| F106 | `baselineOK=valid&&sig==modelHash()&&isfinite(r0)&&r0>0&&isfinite(x0)&&inCoverage(t0,h0);` |
| F111 | `void resetMQDetector(){mqX=mqY=mqResidual=mqZ=NAN;mqEWMA=0;voteN=votePos=votePositive=0;memset(votes,0,sizeof(votes));mqAlert=false;lastMQInference=0;}` |
| F112 | `float polynomial(float t,float h){t=(t-25.0f)/5.0f;h=(h-75.0f)/10.0f;return MQ_BETA[0]*t+MQ_BETA[1]*h+MQ_BETA[2]*t*t+MQ_BETA[3]*h*h+MQ_BETA[4]*t*h;}` |
| F113 | `void updateMQModel(uint32_t now){` |
| F117 | `if(!mq.valid\|\|now-mq.at>1500UL\|\|mq.seq==lastMQUsedSeq){mqStatus="…";resetMQDetector();return;}` |
| F123 | `mqEWMA=MQ_ALPHA*fmaxf(0,mqZ)+(1-MQ_ALPHA)*mqEWMA;` |
| F124 | `votes[votePos]=mqEWMA>MQ_LIMIT;votePos=(votePos+1)%5;if(voteN<5)voteN++;` |
| F125 | `votePositive=0;for(int i=0;i<voteN;i++)if(votes[i])votePositive++;` |
| F126 | `mqAlert=voteN==5&&votePositive>=3;lastMQInference=now;` |
| F127 | `mqStatus=voteN<5?"…":mqAlert?"…":"…";` |
| F131 | `float dustHist[30];uint8_t dustN=0,dustPos=0;uint32_t highSince=0,lastDustGood=0;bool highTracking=false;` |
| F133 | `float median30(){float v[30];memcpy(v,dustHist,dustN*sizeof(float));qsort(v,dustN,sizeof(float),compareFloat);return dustN%2?v[dustN/2]:(v[dustN/2-1]+v[dustN/2])*.5f;}` |
| F134 | `void resetDust(){dustN=dustPos=0;highTracking=false;highSince=0;lastDustGood=0;}` |
| F136 | `d.filtered=d.z=NAN;d.ready=d.high=false;d.history=0;` |
| F138 | `if(lastDustGood&&d.at-lastDustGood>2000UL)resetDust();lastDustGood=d.at;` |
| F139 | `dustHist[dustPos]=d.on;dustPos=(dustPos+1)%30;if(dustN<30)dustN++;` |
| F140 | `d.history=dustN;d.filtered=median30();d.z=(d.filtered-DUST_BASE)/DUST_SD;` |
| F141 | `d.ready=dustN==30;if(!d.ready)return;` |
| F142 | `if(d.filtered>=DUST_HIGH){if(!highTracking){highTracking=true;highSince=d.at;}d.high=d.at-highSince>=10000UL;}` |
| F143 | `else {highTracking=false;highSince=0;}` |
| F150 | `uint32_t next=micros()+DUST_PERIOD_US,seq=0,mqSeq=0;` |
| F151 | `uint16_t count=0,bad=0,missed=0,good=0,offGood=0,minP=65535,maxP=0;` |
| F152 | `float onSum=0,offSum=0;` |
| F153 | `uint32_t mqRawSum=0,mqMvSum=0;uint8_t mqN=0;bool mqHighRange=false;` |
| F156 | `int32_t remaining=(int32_t)(next-micros());` |
| F157 | `if(remaining>2000){vTaskDelay(1);continue;}` |
| F158 | `if(remaining>0)delayMicroseconds((uint32_t)remaining);` |
| F159 | `uint32_t nowUs=micros();uint32_t late=nowUs-next;` |
| F160 | `if(late>=DUST_PERIOD_US){uint32_t skipped=late/DUST_PERIOD_US;missed=(uint16_t)(skipped>65535UL-missed?65535UL:missed+skipped);next+=skipped*DUST_PERIOD_US;}` |
| F163 | `digitalWrite(LED_PIN,HIGH);uint32_t start=micros();` |
| F164 | `while((uint32_t)(micros()-start)<DUST_SAMPLE_US){}` |
| F165 | `uint32_t sampleAt=micros()-start;int onRaw=analogRead(DUST_PIN);` |
| F166 | `while((uint32_t)(micros()-start)<DUST_PULSE_US){}` |
| F167 | `digitalWrite(LED_PIN,LOW);uint32_t width=micros()-start;` |
| F168 | `if(width<minP)minP=(uint16_t)width; if(width>maxP)maxP=(uint16_t)(width>65535UL?65535UL:width);` |
| F169 | `bool goodOn=onRaw>0&&onRaw<4095&&width>=300&&width<=340&&sampleAt>=280&&sampleAt<=300;` |
| F171 | `if(offRaw>0&&offRaw<4095){offSum+=DIVIDER*esp_adc_cal_raw_to_voltage(offRaw,&dustCal);offGood++;}` |
| F173 | `if(count==100){` |
| F176 | `d.valid=good>=95&&missed==0&&isfinite(d.on)&&d.on>=DUST_LOW*.5f;` |
| F178 | `count=bad=missed=good=offGood=maxP=0;minP=65535;onSum=offSum=0;` |
| F181 | `if((int32_t)(next-micros())>3000){` |
| F183 | `if(mqN==20){` |
| F184 | `float raw=mqRawSum/20.0f;` |
| F185 | `if(!mqHighRange&&raw>=3900){mqHighRange=true;analogSetPinAttenuation(MQ_PIN,ADC_11db);(void)analogRead(MQ_PIN);}` |
| F187 | `MQReading m={};m.seq=++mqSeq;m.at=millis();m.pinV=mqMvSum/20000.0f;m.aoV=m.pinV*DIVIDER;` |
| F188 | `m.valid=raw>2&&raw<4090&&m.aoV>0&&m.aoV<MQ_VCC;` |
| F189 | `m.rs=m.valid?MQ_RL*(MQ_VCC/m.aoV-1):NAN;` |
| F193 | `mqN=0;mqRawSum=mqMvSum=0;` |
| F197 | `vTaskDelay(1);` |
| F208 | `if(s.haveSample && in.sampleAt-s.lastSample>CONTROL_FRESH_MS){s.forecastVotes=0;s.recovery=false;}` |
| F211 | `s.forecast=in.trendReady?fmaxf(0.0f,in.mean+FORECAST_MIN*in.rate):NAN;` |
| F213 | `if(preventive){if(s.forecastVotes<PREVENTIVE_VOTES)s.forecastVotes++;}else s.forecastVotes=0;` |
| F227 | `s.on=false;s.recovery=false;s.forecastVotes=0;s.reason="…";return;` |
| F239 | `bool fanOn=false;uint32_t fanStarted=0;uint64_t fanAccum=0;` |
| F242 | `void setFan(bool on){uint32_t now=millis();if(on==fanOn)return;if(fanOn)fanAccum+=(uint32_t)(now-fanStarted);fanOn=on;if(on)fanStarted=now;digitalWrite(FAN_PIN,on?HIGH:LOW);}` |
| F243 | `uint64_t fanMs(){return fanAccum+(fanOn?(uint32_t)(millis()-fanStarted):0);}` |
| F245 | `PolicyInput livePolicyInput(uint32_t now){` |
| F256 | `int fails=0;` |
| F259 | `auto step=[&](uint32_t t,uint16_t c,bool fresh=true,bool trend=false,float mean=0,float rate=0){applyPolicy(s,{t,t,fresh,trend,c,mean,rate});};` |
| F260 | `step(1000,700);check(!s.on,"…");` |
| F261 | `step(6000,1000);check(s.on,"…");` |
| F262 | `step(11000,900);check(s.on,"…");check(strcmp(s.reason,"…")==0,"…");` |
| F263 | `for(uint32_t t=16000;t<=126000;t+=5000)step(t,700);` |
| F265 | `for(uint32_t t=131000;t<=196000;t+=5000)step(t,700);` |
| F267 | `s=PolicyState();step(1000,900,true,true,890,12);step(6000,900,true,true,895,12);` |
| F269 | `applyPolicy(s,{6100,6000,true,true,900,895,12});check(!s.on&&s.forecastVotes==2,"…");` |
| F270 | `step(11000,900,true,true,900,12);check(s.on,"…");` |
| F271 | `step(16000,900,false);check(!s.on,"…");` |
| F272 | `s=PolicyState();step(1000,1050);step(6000,700);step(11000,800);check(!s.recovery&&s.on,"…");` |
| F273 | `s=PolicyState();step(1000,850,true,true,850,20);step(21000,850,true,true,850,20);check(s.forecastVotes==1,"…");` |
| F279 | `if(c=='0'){setFan(false);policy=PolicyState();fanMode=FanMode::STANDBY;fanReason="…";lastFanEvent=fanReason;Serial.println("…");}` |
| F280 | `else if(c=='1'){setFan(false);policy=PolicyState();fanMode=FanMode::MANUAL_TEST;setFan(true);fanReason="…";lastFanEvent=fanReason;Serial.println("…");}` |
| F285 | `void scdTask(uint32_t now){` |
| F286 | `if(scdValid&&now-lastSCD>30000UL){scdValid=false;clearOcc();resetMQDetector();mqStatus="…";}` |
| F287 | `if(!scdInit\|\|now-lastPoll<1000UL)return;lastPoll=now;` |
| F288 | `bool ready=false;if(scd40.getDataReadyStatus(ready)\|\|!ready)return;` |
| F289 | `uint16_t c=0;float t=NAN,h=NAN;` |
| F290 | `if(scd40.readMeasurement(c,t,h)\|\|!c\|\|!isfinite(t)\|\|!isfinite(h)\|\|h<0\|\|h>100)return;` |
| F293 | `const char* dustStatus(){if(!dust.seq\|\|millis()-dust.at>2500UL\|\|!dust.valid)return "…";if(!dust.ready)return "…";if(dust.high)return "…";if(dust.filtered>=DUST_HIGH)return "…";if(dust.filtered>=DUST_ELEV)return "…";if(dust.filtered<DUST_LOW)return "…";return "…";}` |
| F295 | `const char* currentMQStatus(){if(!scdValid)return "…";if(!mq.seq\|\|!mq.valid\|\|millis()-mq.at>1500UL)return "…";if(lastMQInference&&millis()-lastMQInference>MQ_GAP_MS)return "…";return mqStatus;}` |
| F298 | `bool controlFresh(uint32_t now){return scdValid&&now-lastSCD<=CONTROL_FRESH_MS;}` |
| F299 | `bool gasFresh(uint32_t now){return controlFresh(now)&&mq.valid&&mq.seq&&now-mq.at<=1500UL&&lastMQInference&&now-lastMQInference<=MQ_GAP_MS&&voteN==5;}` |
| F300 | `bool dustModelFresh(uint32_t now){return dust.valid&&dust.seq&&now-dust.at<=2500UL&&dust.ready;}` |
| F301 | `const char* roomCondition(uint32_t now){` |
| F314 | `void addNum(String &j,const char* key,float v,int dec=3);` |
| F319 | `readSnapshots();uint32_t now=millis();bool dustFresh=dust.seq&&now-dust.at<=2500UL&&dust.valid;` |
| F320 | `bool mqFresh=mq.seq&&now-mq.at<=1500UL&&mq.valid;` |
| F322 | `String j="…";j+=String(now);j.reserve(2600);` |
| F323 | `addBool(j,"…",scdValid);addNum(j,"…",scdValid?co2:NAN,0);addNum(j,"…",scdValid?temp:NAN);addNum(j,"…",scdValid?rh:NAN);` |
| F324 | `addNum(j,"…",scdValid?now-lastSCD:NAN,0);` |
| F325 | `addNum(j,"…",OCC_BASE,0);addNum(j,"…",occMean);addNum(j,"…",occDelta);addNum(j,"…",occSlope);addNum(j,"…",occReady?occEstimate:NAN);addNum(j,"…",occReady?occEven:NAN,0);addText(j,"…",occStatus());` |
| F326 | `addBool(j,"…",mqFresh);addBool(j,"…",baselineOK);addNum(j,"…",mqFresh?mq.pinV:NAN);addNum(j,"…",mqFresh?mq.aoV:NAN);addNum(j,"…",mqFresh?mq.rs:NAN);addNum(j,"…",r0);addNum(j,"…",modelFresh?mqResidual:NAN);addNum(j,"…",modelFresh?mqZ:NAN);addNum(j,"…",modelFresh?mqEWMA:NAN);addNum(j,"…",modelFresh?votePositive:NAN,0);addBool(j,"…",modelFresh&&mqAlert);addText(j,"…",currentMQStatus());addBool(j,"…",scdValid&&rh>=88);` |
| F327 | `addBool(j,"…",dustFresh);addNum(j,"…",dustFresh?dust.on:NAN);addNum(j,"…",dustFresh?dust.off:NAN);addNum(j,"…",dustFresh?dust.delta:NAN);addNum(j,"…",dustFresh?dust.filtered:NAN);addNum(j,"…",dustFresh?dust.z:NAN);addNum(j,"…",dust.history,0);addNum(j,"…",dust.rejected,0);addNum(j,"…",dust.missed,0);addNum(j,"…",dust.minPulse,0);addNum(j,"…",dust.maxPulse,0);addBool(j,"…",dustFresh&&dust.high);addText(j,"…",dustStatus());` |
| F332 | `addNum(j,"…",controlOK&&occReady?fmaxf(0.0f,occMean+FORECAST_MIN*occSlope):NAN,1);` |
| F333 | `addNum(j,"…",policy.forecastVotes,0);addNum(j,"…",policy.on&&policy.recovery?(policy.lastSample-policy.recoveryAt)/1000.0f:0,1);` |
| F334 | `addNum(j,"…",fanMode==FanMode::AUTO&&fanOn&&now-fanStarted<FAN_MIN_ON_MS?(FAN_MIN_ON_MS-(now-fanStarted))/1000.0f:0,1);` |
| F336 | `addBool(j,"…",fanOn);addText(j,"…",fanModeText());addText(j,"…",fanReason);addText(j,"…",lastFanEvent);addNum(j,"…",fanMs()/1000.0,2);addNum(j,"…",isfinite(FAN_RATED_W)?FAN_RATED_W*fanMs()/3600000.0:NAN,5);j+='}';return j;` |
| F340 | `Serial.begin(115200);delay(500);bootMs=millis();` |
| F342 | `pinMode(MQ_PIN,INPUT);pinMode(DUST_PIN,INPUT);analogReadResolution(12);analogSetPinAttenuation(DUST_PIN,ADC_11db);analogSetPinAttenuation(MQ_PIN,ADC_0db);` |
| F344 | `esp_adc_cal_characterize(ADC_UNIT_1,ADC_ATTEN_DB_11,ADC_WIDTH_BIT_12,1100,&dustCal);` |
| F345 | `loadMQReference();Wire.begin(SDA_PIN,SCL_PIN);Wire.setClock(100000);scd40.begin(Wire,0x62);scd40.stopPeriodicMeasurement();delay(500);scdInit=scd40.startPeriodicMeasurement()==0;` |
| F350 | `adcTaskOK=xTaskCreatePinnedToCore(adcWorker,"…",4096,nullptr,2,nullptr,1)==pdPASS;` |
| F356 | `uint32_t now=millis();if(now-lastReport>=1000UL){lastReport=now;Serial.println(telemetry());}` |
| F357 | `delay(1);` |
| H9 | `constexpr bool PROTOTYPE_ONLY = true;` |
| H11 | `constexpr float TRAIN_ROOM_VOLUME_M3 = 43.6079f;` |
| H12 | `constexpr float HISTORICAL_EMPTY_CO2_PPM = 511.0f;` |
| H14 | `constexpr float HISTORY_SECONDS = 60.0f;` |
| H15 | `constexpr float MIN_HISTORY_SECONDS = 50.0f;` |
| H17 | `constexpr float DELTA_SCALE_PPM = 100.0f;` |
| H18 | `constexpr float RATE_SCALE_PPM_PER_MIN = 10.0f;` |
| H20 | `constexpr float INTERCEPT = 3.176339566f;` |
| H21 | `constexpr float BETA_DELTA = 3.276897848f;` |
| H22 | `constexpr float BETA_RATE = 0.8872977638f;` |
| H24 | `constexpr float TRAIN_DELTA_MIN = -11.61538462f;` |
| H25 | `constexpr float TRAIN_DELTA_MAX = 391.1f;` |
| H27 | `constexpr float TRAIN_RATE_MIN = -138.7419172f;` |
| H28 | `constexpr float TRAIN_RATE_MAX = 28.51248862f;` |
| H30 | `constexpr float MAX_PEOPLE = 16.0f;` |
| H42 | `return raw < 0.0f ? 0.0f :` |

F348 also returns HTTP 200 for the root and live telemetry routes.

### Sharp timed acquisition (F162–171)

```cpp
    int offRaw=analogRead(DUST_PIN);
    digitalWrite(LED_PIN,HIGH);uint32_t start=micros();
    while((uint32_t)(micros()-start)<DUST_SAMPLE_US){}
    uint32_t sampleAt=micros()-start;int onRaw=analogRead(DUST_PIN);
    while((uint32_t)(micros()-start)<DUST_PULSE_US){}
    digitalWrite(LED_PIN,LOW);uint32_t width=micros()-start;
    if(width<minP)minP=(uint16_t)width; if(width>maxP)maxP=(uint16_t)(width>65535UL?65535UL:width);
    bool goodOn=onRaw>0&&onRaw<4095&&width>=300&&width<=340&&sampleAt>=280&&sampleAt<=300;
    if(goodOn){onSum+=DIVIDER*esp_adc_cal_raw_to_voltage(onRaw,&dustCal);good++;}else bad++;
    if(offRaw>0&&offRaw<4095){offSum+=DIVIDER*esp_adc_cal_raw_to_voltage(offRaw,&dustCal);offGood++;}
```

### JSON field inventory (F322–336)

`uptime_ms`, `scd_valid`, `co2_ppm`, `temperature_c`, `rh_pct`, `scd_age_ms`, `occupancy_baseline_ppm`, `occupancy_mean_ppm`, `occupancy_delta_ppm`, `co2_slope_ppm_min`, `occupancy_estimate`, `occupancy_even`, `occupancy_status`, `mq_adc_valid`, `mq_baseline_valid`, `mq_gpio_v`, `mq_ao_v`, `mq_rs_kohm`, `mq_r0_kohm`, `mq_residual`, `mq_z`, `mq_ewma`, `mq_votes`, `mq_anomaly`, `mq_status`, `mq_high_rh_caution`, `dust_valid`, `dust_on_mv`, `dust_off_mv`, `dust_delta_mv`, `dust_filtered_mv`, `dust_z`, `dust_history`, `dust_rejected`, `dust_missed`, `dust_pulse_min_us`, `dust_pulse_max_us`, `dust_high_confirmed`, `dust_status`, `room_condition`, `control_co2_fresh`, `gas_model_ready`, `dust_model_ready`, `gas_warning`, `dust_warning`, `co2_demand`, `occupancy_context_valid`, `co2_forecast_10min_ppm`, `preventive_votes`, `fan_recovery_s`, `fan_min_on_remaining_s`, `outside_air_quality_known`, `ventilation_conflict_warning`, `fan_on`, `fan_mode`, `fan_reason`, `fan_last_event`, `fan_runtime_s`, `fan_estimated_wh`

### Embedded fan-policy checks

F255–275 contains the following assertions. They operate on local state with no GPIO access.

- F260: normal stays off
- F261: 1000 ppm starts fan
- F262: hysteresis holds on
- F262: minimum runtime active
- F264: recovery not yet 180 seconds
- F266: continuous recovery releases fan
- F268: preventive needs three fresh readings
- F269: repeated poll does not add votes
- F270: preventive start
- F271: stale CO2 suspends automatic fan
- F272: recovery interrupted by rebound
- F273: measurement gap resets forecast votes

## Verification record

| Command or check | Observed result |
|---|---|
| `cmp AGENTS.md inputs/AGENTS.md` and `diff -qr` on corresponding code, data, reference and brand directories | Exit 0 for all comparisons. |
| Python 3 `csv.DictReader` over each canonical data/*.csv, ISO timestamp differences and median absolute deviations | All ten parsed with consistent row widths. Blank cells and individual ranges are tabulated above. Byte comparisons cover the mirrored copies. |
| `file inputs/brand/logos/*` and Python ElementTree parse of each SVG | PNG/ICO formats and dimensions inspected; all four SVGs parsed. No browser rendering or playback test. |
| `g++ -std=c++17 -x c++ - -o <in-memory executable>` and execution of the resulting host binary | Compiled unchanged F18–36, F50–62, F204–231, F255–276 with standard headers, Serial.printf mapped to std::printf, and main returning policySelfTest(true). Twelve PASS lines; final output: `[TEST] SUMMARY failed=0 (no physical fan action)`. |
| `python3 -B inputs/reference/test_backend.py` | Exit 1 at import: `ModuleNotFoundError: No module named 'vigil_backend'`. Zero of nine tests ran. |
| `curl -fLsS --max-time 10` against the four official documentation URLs above | HTTP 403 on retry. Plan figures and current service support require independent confirmation. |
| `git check-ignore --no-index .env.local web/.next/example firmware/build/example` | All three paths matched. |
| `git diff e928cb3 --exit-code -- inputs` | Exit 0. |

The names in .env.example are proposed server-side placeholders with empty values. No deployment, model fitting, embedded build, electrical timing measurement or cloud integration test was performed.

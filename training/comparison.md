# Phase 1 model comparison

The four JSON specifications under specs/ are the offline handoff. Only mq135_candidate.json contains reconstructed gas coefficients and segment anchors. Production device anchors remain unknown. All four model families have synthetic fixtures in golden.json. Source locations in the specs refer to immutable repository inputs.

## Occupancy

The imported header supplies the intercept 3.176339566, delta coefficient 3.276897848 and rate coefficient 0.8872977638. The features use mean CO₂ relative to 511 ppm, scaled by 100 ppm, and the least-squares slope scaled by 10 ppm/min. Preserve the header's range flags, clip at 0 and 16, and round the display to the nearest even count. The source window and readiness gates are in inputs/code/VIGIL_Phase3_Fixed.ino lines 70–89. The clean-air and baseline logs do not constitute an occupancy training set. The potentially synthetic test_2 log and the hybrid trainer are excluded from the pipeline.

Independent Python feature and inference calculations matched the host-compiled sketch across 46 synthetic samples including warm-up, a sliding window, gap resets, rising and falling trends and clipping. On ready samples the fixture generator also checks the original header function against the sketch estimate. Python-to-sketch tolerance is 0.0001 absolute, to accommodate float precision. These results establish fixture-level numerical parity. Room transfer and real-world counting accuracy require measured, independently labelled sessions.

## MQ135

The six canonical clean-air files contributed 2,894 eligible rows. Uptime regression splits the ventilated log into segments of 52 and 941 rows. Warm-up excludes the entire first segment. The comparison artifact records every segment's retained count. The excluded night_indoor session starts early in warm-up and contains a large resistance excursion, with no independent evidence of a stable reference. See the per-file audit in docs/phase0_report.md.

The original anchor fitter is missing. For this **candidate** use whole-segment medians of eligible resistance, temperature and humidity as R0, T0 and RH0. Set x0 to the median log(R0/Rs). Retain positive resistance after firmware warm-up and within firmware climate coverage. Fit ordinary least squares with no intercept to the difference of the five polynomial terms between sample and anchor. Rows have equal weight. These retrospective anchors use the full eligible segment, so the fit is descriptive and its residuals are in-sample. No challenge-event labels or independent holdout validate alert sensitivity. Reconstructing an alarm limit from these residuals would require an unsupported operating-point assumption.

| Parameter | Firmware | Reconstructed |
|---|---:|---:|
| t | −0.0978957479 | 0.861118363153 |
| h | 0.113921441 | 0.678650353596 |
| t² | 0.0306626048 | 1.557222158896 |
| h² | 0.0722774401 | 0.052086287197 |
| t·h | −0.0166802 | 1.107304444915 |
| Residual median | −0.0130058485 | −0.001033679103 |
| Residual scale | 0.0478087528 | 0.034110998027 (scaled MAD) |

Retain F33–34 coefficients, positive-score EWMA with α=0.2 and strict limit 4.87158753, and three confirmations in a full five-vote window. F denotes inputs/code/VIGIL_Phase3_Fixed.ino. Twelve synthetic observations exercised warm-up, corrected scoring, confirmation, repeated sequence, stale ADC and coverage rejection with an explicitly synthetic accepted anchor. They test response anomaly scoring only. Deployment still requires valid device anchors and signature validation (F98–109).

## Sharp

| ON aggregate treatment | n | Median mV | 1.4826 × MAD, mV |
|---|---:|---:|---:|
| Firmware provisional reference, F31 | — | 1458.52 | 147.585 |
| Baseline 4, all raw ON values | 3586 | 1498.29 | 192.782478 |
| Full 30-aggregate rolling median windows | 3557 | 1492.15 | 198.460836 |

The rolling analysis discards partial windows and clears history across timestamp gaps exceeding F138. The CSV lacks the complete pulse-rejection and missed-period counts needed to reproduce the acquisition validity flag, so this comparison assumes logged ON rows are valid. Missing OFF/delta values cannot replace the ON signal. Filtering alone does not explain the discrepancy. Phase 0 fixed-window medians span 1346.51–1640.45 mV and the original selection remains unknown. Retain the authorized low/elevated/high thresholds of 1015.76/1901.28/2048.86 mV. Forty-eight fixture observations check warm-up, persistence, gap and invalid resets. Physical particle exposure and sensor timing remain unvalidated.

## Forecasts

The ten-minute horizon, window-mean linear forecast and zero floor come from F28,211,332. Persistence holds the latest fresh observation. The reconstructed robust fixture calculation takes the median pairwise slope over the supplied history and extrapolates from its last observation. On the 61-point ramp it produces 780 ppm. Over the 181-point legacy evaluation ramp, using 61-point histories and exact timestamp matching produces one fully observed forecast origin and paired MAEs of 0 ppm (robust) and 120 ppm (persistence). These history and matching choices describe the fixture evaluator. The original robust window, outlier policy, off-grid matching tolerance and general backend behavior remain unknown. The original nine-test suite still needs its missing backend. No substitute backend was built.

## Verification and handoff

On Linux with Python 3.12.14, NumPy 2.3.5 and g++ 14.2.0, run from the repository root:

```sh
python3 training/build.py
python3 training/vectors.py
python3 -m unittest discover -s training -v
git diff --exit-code
git diff phase-0 --exit-code -- inputs
```

Both generators exited 0. The unit runner printed “Ran 5 tests” and “OK”. Both diffs exited 0 after regeneration. The firmware oracle compiles only the original sensor routines with a host shim, using a RAM-backed executable library. No external API, device credentials, hardware or network are required.

**Phase 2 readiness.** Acquisition work can start after approval. Preserve each timestamped Sharp aggregate, validity flag and pulse diagnostics in order within upload batches, including invalid aggregates and outage gaps. Preserve MQ sequence/freshness, boot boundaries, ADC measurements and anchor identity. Otherwise a later backend cannot reproduce these histories. Configure device credentials at provisioning. Verify real pulse timing, ADC ranges, TLS/connectivity and local fan safety on hardware. Sharp calibration, measured occupancy performance and robust forecast behavior outside the fixtures remain open validation work.

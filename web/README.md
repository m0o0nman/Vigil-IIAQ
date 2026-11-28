# Phase 3 backend handoff

The ESP32 posts captured observations to seven Node.js App Router endpoints under this project's `app/api`. Firestore owns the inference state and history. RTDB provides the owner's live view. Python is used offline only. The server can restart between any two uploads.

## Run and configure

From `web/`, use Node 24, `npm ci`, `npm test`, `npm run typecheck` and `npm run build`. Use `npm run dev` for local development. Keep the repository-level training specs available at build time; the Next.js project root for Vercel is `web`. No Firebase credentials are needed for the build or the mock tests.

Copy the variable names from [.env.example](.env.example) into private server settings. Set VIGIL_DEVICE_SECRET to the device's provisioned secret, VIGIL_OWNER_UID to the sole authorized Firebase Auth UID, and FIREBASE_DATABASE_URL to the intended RTDB instance. FIREBASE_SERVICE_ACCOUNT_JSON supplies a private Admin credential on a host without configured Application Default Credentials. Never put these values in NEXT_PUBLIC variables. The rule configuration and index exemptions are in [firebase.json](firebase.json), [database.rules.json](database.rules.json), [firestore.rules](firestore.rules) and [firestore.indexes.json](firestore.indexes.json).

## API

| Endpoint | Authentication and request | Result |
|---|---|---|
| POST /api/ingest | X-Device-Secret and the exact Phase 2 JSON envelope, 1–10 ordered records | Compact HTTP 200 JSON with Content-Length, boot_id, ack_seq, mode, fan_cmd and fan_seconds |
| POST /api/command | Owner, JSON mode equal to auto, off or freshen | Stored mode and absolute expiry in server epoch milliseconds |
| POST /api/calibrate/start | Owner, sensor equal to mq135, sharp or occupancy | Session UUID and collecting status |
| GET /api/calibrate/status | Owner | Current session and collecting/idle status |
| POST /api/calibrate/abort | Owner, session UUID | Marks the matching session aborted |
| POST /api/model/rollback | Owner, model name and version ID | Selects an existing approved version and invalidates the live inference view |
| GET /api/export/[session] | Owner, boot ID or calibration UUID | Streamed CSV including the durable open minute for telemetry. Calibration CSV preserves the sensor's source headers. |

Owner routes require a Firebase ID token in `Authorization: Bearer <token>`. The Admin SDK checks revocation and the server checks the exact UID. Owner mutations also require an **Idempotency-Key** of 1–128 ASCII letters, digits, underscores or hyphens. Reuse it when retrying the same action. The transaction stores the result and rejects a different action using the same key. This prevents retries from extending Freshen or opening a second session.

Use the [Phase 2 envelope and example](../firmware/README.md). Device authentication runs before body parsing. The parser limits JSON to 32 KiB, validates the exact fields and checks modular timestamps, sensor ranges, freshness and observation sequence. JSON record sequences must fit JavaScript's exact integer range. Request errors return 400, 401, 403, 409, 413 or 415 as applicable. An unavailable database or incomplete model configuration returns 503. The ACK covers the last sequence only after durable processing and projection recovery. An exact duplicate may receive an ACK and OFF with zero lease.

## Durable schema and recovery

| Store and path | Contents and lifecycle |
|---|---|
| Firestore system/projection | Transactional coordinator. Holds the current boot's cursor, unwrapped capture clock, open history minute, rolling model windows, forecast origins, metric accumulators, approved spec snapshot, requested command and revisioned RTDB projection. |
| sessions/{boot} | Cursor and open minute for a candidate or retired boot. The active session resides in the coordinator. Retirement seals its open minute. |
| sessions/{boot}/minutes/{minute} | One history document per **device capture minute**, keyed by sequence inside rows. Each row contains the original sample, anchor metadata, model versions, model outputs, fan decision context and forecast. The minute includes cumulative matched metrics and missed-target count. |
| models/{name}, models/{name}/versions/{id} | Active pointer and version document containing approved flag and spec. The first use seeds missing v0 documents transactionally from the approved Phase 1 specs. Rollback invalidates the persisted bundle. During Phase 3 only approved specs equal to the reviewed Phase 1 parameters can load. |
| calibrations/{uuid}, calibrations/{uuid}/minutes/{boot}_{minute} | Sensor, status, timestamps, ordered source column names and raw capture rows with validity flags. Capture begins with current eligible data at/after start. Missing logger fields remain null. Occupancy rows receive no training label. |
| ownerOperations/{hashed-key} | Mutation fingerprint, creation time and prior result. No retention policy has been applied. |
| RTDB /live/latest, /state/mode, /buffer, /command | Latest eligible result and device-reported state, current mode, five-minute capture summaries and owner command/expiry. Root revision fences concurrent updates. /access/owner gates client reads. Client writes are denied. |

**Order and gaps.** Within a boot, the Firestore transaction serializes updates by sequence. Exact duplicates do not advance state. An overlapping prefix is verified against durable samples. A missing predecessor without corresponding FIFO eviction returns 409 so the earlier batch can commit first. A proven overflow records the gap, discards continuous windows and resumes from the next real observation. Late data conflicting with sealed history is rejected. Evictions and missing sequences are reported separately. Sensor timestamps and MQ sequence counters retain unsigned wrap semantics.

**Restarts and reboots.** An open minute is durable on every accepted upload. The next minute boundary seals it; an offline device's last open minute is still exportable. A server restart reloads the cursor, windows, versions and command lease. A new device boot uses independent state. Replacing an existing live boot requires forward progress on separate requests and an inactive previous live session. A retired boot can complete history only. Version changes clear inference windows and pending comparisons before the next sample. The first accepted batch for a boot cannot issue an ON lease.

**Cross-store failure.** The Firestore transaction commits history, cursor and the desired live revision together. Only then does a monotonic RTDB transaction publish the projection. A failed mirror causes request failure; a retry reads the committed state and reattempts the projection before ACK. A higher RTDB revision fences an older result. This is eventual recovery on the next request, with a possible stale live view in the interim. Owner status reads can also repair the projection. No background process or warm server instance is required.

## Inference and ventilation

Model code and source parameters are in [models.ts](src/models.ts), [engine.ts](src/engine.ts) and the [Phase 1 comparison](../training/comparison.md). Each Sharp aggregate, including an invalid one, advances or resets the rolling filter in capture order. Each distinct fresh SCD40 sample drives occupancy and the MQ sample paired at capture. The MQ reference must pass the original float-bit signature and anchor/coverage checks. The reconstructed candidate is excluded. Historical outputs retain validity context; clients should use readiness flags and age when displaying them.

Forecasts include persistence, the firmware window-mean linear projection, and the reconstructed median pairwise slope over 61 fresh samples. Only exact target timestamps with forecasts from all three methods contribute to paired MAE, RMSE and signed prediction-minus-actual bias. Missed targets accrue separately. The historical robust algorithm and off-grid tolerance remain unknown. Synthetic ramp parity establishes the available reference expectations.

Auto uses the original immediate and preventive CO₂ criteria, consecutive fresh votes, hysteresis, minimum run and sustained recovery (original sketch lines 23–29 and 204–230). Freshen uses the original supervised ten-second duration. Automatic ON commands also use this duration as a short renewable lease. Remaining Freshen seconds are rounded down. Freshen ends in Off. Owner commands express intent; sample.fan_on, fan_reason and local_override report the actuator. Stale or replay-only requests receive OFF with zero lease. The backend uses the minimum observed server-time-minus-capture offset to detect extra delay. Absolute age of the first observation is unknowable from uptime alone. The firmware's own lease deadline and higher-priority local safety rule remain necessary. Consumers must age received_at and command expiry even when no new uploads arrive.

Calibration start/status/abort and raw collection are available for Phase 4. Quality gates, automatic activation and refitting are outside this phase.

## Capacity and operating limits

At the nominal five-second upload interval with roughly one Sharp aggregate per second, one continuously connected device produces **17,280 requests, 86,400 observations and 1,440 minute documents per day**. Steady-state Firestore cost is approximately one coordinator read and write per upload plus one sealing write per minute: **17,280 reads and 18,720 writes/day** before retries, exports, boot transitions, calibration, owner actions or initialization. There is one RTDB projection transaction per live batch. Reconnects may drain faster in batches of ten. Vercel would receive approximately 518,400 ingest invocations per 30 days.

The included synthetic capacity test ran 254 batches. It measured serialized JSON, not Firebase billing or network compression.

| Measurement | Bytes | Implication at continuous cadence |
|---|---:|---|
| Five-record request | 3,277 | About 57 MB/day inbound to the application |
| Largest completed minute in the fixture | 72,362 | At this size, about 104 MB/day or 3.13 GB per 30 days before indexes |
| Largest coordinator; mean read during the final five minutes | 97,552; 64,110 | About 1.11 GB/day of logical Firestore coordinator reads at the measured mean. Billable transfer depends on placement. |
| Final five-minute projection | 14,274 | About 247 MB/day of logical full projections at that size. Root transaction retries, cold connections and browser listeners change actual transfer. |

The installed official Google Firestore protocol states that a document must not exceed 1 MiB minus four bytes (google/firestore/v1/document.proto, line 35). The application guards the active coordinator at 750,000 serialized JSON bytes to allow encoding headroom. The synthetic size measurements do not establish a worst-case bound or a production benchmark. Index exemptions cover large nested maps. The official online quota and pricing pages returned HTTP 403 from this environment, including a retry for Firestore quotas. Current Spark and Hobby allowances could not be independently verified. [Firestore quotas](https://firebase.google.com/docs/firestore/quotas) · [RTDB limits](https://firebase.google.com/docs/database/usage/limits) · [Firebase pricing](https://firebase.google.com/pricing) · [Vercel Hobby](https://vercel.com/docs/plans/hobby)

**Operating decision.** Indefinite full-resolution retention conflicts with any finite free storage allowance. For scale, a 1 GiB storage budget would hold about ten days at the measured minute size, before index overhead. Before continuous use, confirm current allowances and approve a retention period or bounded session schedule. The implementation retains history. No deletion, billing upgrade or architecture change was authorized.

## Verification and remaining integration work

| Command | Result |
|---|---|
| `npm test` | 2 files, 19 tests passed. Immutable fixtures cover 46 occupancy, 46 linear forecast, 12 MQ and 48 Sharp outputs. Robust ramp 780 ppm; paired robust and persistence MAEs 0 and 120 ppm. |
| `./node_modules/.bin/vitest run --disableConsoleIntercept --reporter=verbose` | Full suite passed, including the synthetic size measurements above. |
| `npm run typecheck` | Exit 0. |
| `NEXT_TELEMETRY_DISABLED=1 npm run build` | Next.js 16.4.6 compiled successfully and listed all seven routes as dynamic server routes. |
| Local production server, POST /api/ingest and GET /api/calibrate/status without authentication | Both returned HTTP 401. No database connection was needed. |
| From repository root, `python3 -m unittest discover -s training -v` | Ran 5 tests, OK. |
| `git diff --exit-code phase-2 -- inputs training firmware`; recursive path and byte comparison to phase-2 | Exit 0; identical paths and bytes for all 65 inputs. |

Vitest exercises the real parser, inference, route authorization and transactional service using a serialized copy-on-commit store and injected token verifier. It simulates concurrent requests, retries, cold starts, partial failures, command expiry, rollback, minute boundaries and calibration state. Live Firebase Auth, deployed rules, Admin SDK transactions, RTDB WebSockets, Vercel and physical ESP32 TLS were not exercised. The Phase 2 target build and supervised safety/timing checks remain prerequisites for hardware deployment. A supervised ingest/ACK/replay round trip and rule checks against isolated Firebase services remain integration gates.

## File inventory

- `app/api/{ingest,command,calibrate/start,calibrate/status,calibrate/abort,model/rollback,export/[session]}/route.ts` — seven route entry points.
- `src/http.ts`, `protocol.ts`, `export.ts` — HTTP authentication, payload validation and CSV formatting.
- `src/service.ts`, `store.ts`, `firebase.ts` — transactions, durable schema, projections and Firebase adapter.
- `src/models.ts`, `engine.ts`, `calibration.ts` — model inference, ventilation, forecast metrics and calibration column mappings.
- `tests/models.test.ts`, `tests/service.test.ts` — fixture parity, backend behavior and usage measurements.
- `firebase.json`, `database.rules.json`, `firestore.rules`, `firestore.indexes.json` — Firebase configuration.
- `package.json`, `package-lock.json`, `tsconfig.json`, `next.config.ts`, `next-env.d.ts`, `.env.example`, `.gitignore` and this handoff — build configuration, environment requirements and reproduction instructions.

## Phase 4 calibration update

The Phase 4 workflow now uses the existing calibration documents and routes for gated measurement, version activation and restore. For current request bodies, lifecycle states, quality evidence, quota planning and Phase 5 integration, see the [calibration handoff](../docs/phase4_calibration.md). The Phase 3 results above record the original backend baseline.

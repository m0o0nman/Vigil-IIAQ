# Phase 5 · Consumer interface

VIGIL uses a light ivory layout, forest text and the supplied branching logo. A shared editorial grid aligns headers, panels and chart sections. The monitor foregrounds the CO₂ reading and room status, with the breathing orb as a visual anchor. Details and Settings hold observation history and owner actions.

## Screens and integration

| Route | Screen | Data and actions |
|---|---|---|
| / | Welcome | Owner sign-in gate, Calibrate and Breathe entry points, and current setup guidance |
| /breathe | Monitor | Live CO₂, approximate occupancy, climate, gas and optical response, forecast and ventilation. Fan requests use POST /api/command. |
| /calibrate | Calibration | Start, poll, abort and retry through the Phase 4 routes. Preparation and sensor readiness guide the operator. Measurement progress uses backend counts and capture duration. Stability and quality are evaluated in the measurement-completion transaction and shown from the returned gates. |
| /details | Analytics | Recharts history, observed and forecast series aligned to device time, matched error counts and metrics, raw sensor diagnostics, actual fan events and CSV download |
| /settings | Owner settings | Active model versions, 20 recent calibration sessions, calibration CSV and confirmed restoration of a passing session's predecessor |

Firebase email/password sign-in uses the existing single-owner architecture. The browser checks owner access with the authenticated calibration status route before subscribing to permitted RTDB paths. An initial rules denial can occur until a device or authorized operation publishes the owner UID to RTDB. The UI reports unavailable live access. Browser variables are the public Firebase app settings in web/.env.example. Admin credentials and the device secret belong exclusively to the server.

The dashboard uses server sensor flags and original freshness limits. It retains the last valid CO₂ observation time in the owner session while the feed ages or disconnects. The displayed wall-clock time is an estimate from the backend ingest clock offset and device capture age. Fumes uses the MQ135 anomaly result. Dust uses the Sharp optical result and identifies the original provisional reference. The UI suppresses current status words for unavailable readings. It keeps requested fan mode and device-reported actuator state separate and waits for a newer report after accepting a command. That report may reflect local safety action. Raw diagnostics identify reported values even when stale.

Two optional **owner-only read views** use existing Phase 3/4 paths and records. GET /api/export/{boot}?view=analytics reads the latest 60 capture-minute buckets, including the open minute, plus persisted match accumulators. GET /api/calibrate/status?view=history reads recent sessions and model pointers. The existing CSV and calibration-response defaults remain available. Details requests history on entry and on explicit refresh. Settings requests history on entry and refreshes after restore. The views introduce no Firebase writes or schema changes. Budget each history refresh for up to 60 archived minute reads plus coordinator/session reads, and a settings refresh for up to 20 session and four model reads. The command document provides current requested mode. Historical commands are unavailable through the approved backend. Fan history shows reported states and reasons. Forecast scores appear only when the backend has paired observations.

## Brand, thresholds and accessibility

The HTML receives CSS custom properties from inputs/brand/colours/colours.json through ui/theme.ts. The palette was checked against the supplied brand files. Ivory #F5F4EC dominates the canvas, with moss #DDE2C8 panels, sage #B2BD7E accents and forest #303D2B type and controls. Status marks use the source Fresh #6E916B, OK #B2BD7E, Stuffy #C3A15E and Poor #B66D5E. Public logo, favicon, font attribution and audio text copies match their tracked originals byte for byte. The interface uses the forest SVG on light surfaces.

Syne uses next/font/google with Arial/sans-serif fallback. The interface uses upright Regular 400 for headings, readings, labels and body copy. Medium 500 marks the selected fan mode, current calibration stage and essential emphasis. Scale, spacing and alignment create hierarchy. Thin rules, restrained rectangular controls and a consistent set of outline icons guide actions. Forest text has calculated contrast **10.41:1 on ivory** and **8.64:1 on moss**. Status labels are textual as well as coloured. Navigation supports keyboard focus and a skip link. Form labels and feedback describe actions, rollback uses a native confirmation dialog, and reduced-motion mode stops the breathing animation. Chromium checked major controls and page overflow at representative widths. Screen-reader and full accessibility conformance testing remain outstanding.

All display boundaries live in web/ui/bands.ts. They are **provisional owner-approved interpretations**. Fresh is below 600 ppm, OK starts at 600, Stuffy at 750 and Poor at 1,000. The 750 and 1,000 values come from inputs/code/VIGIL_Phase3_Fixed.ino line 25. The owner supplied 600 as a display cutoff. Dry is below 30% RH, Comfortable starts at 30% and Humid at 60%, based on the owner's simplified interpretation of EPA humidity guidance. Temperature stays numeric. These bands describe the displayed observations. [EPA indoor humidity guidance](https://www.epa.gov/indoor-air-quality-iaq/what-can-i-do-improve-indoor-air-quality-my-home)

The calibration breathing break uses an original prompt and a restrained prism accent. The privacy-enhanced player is created by an explicit button, uses the exact supplied URL and has no autoplay. The text and official watch link provide a fallback. Actual playback remains unverified.

## Browser evidence

The browser used the same production screen components and a temporary route providing **labelled synthetic fixtures**. The harness lives under web/tests. Production routing contains no fixture route.

- [Owner sign-in](phase5-screenshots/authentication.png)
- [Welcome](phase5-screenshots/welcome.png)
- [Desktop dashboard](phase5-screenshots/dashboard.png)
- [Calibration measuring](phase5-screenshots/calibration.png)
- [Details and analytics](phase5-screenshots/details.png)
- [Settings](phase5-screenshots/settings.png)
- [Tablet dashboard](phase5-screenshots/tablet-dashboard.png)
- [Mobile dashboard](phase5-screenshots/mobile-dashboard.png)
- [Stale device](phase5-screenshots/stale-device.png)

Chromium at 1440, 820 and 390 pixels rendered the source SVG and Syne without horizontal page overflow. The browser checked that visible headings, text and buttons used upright weights at or below 500 and that reduced-motion mode stopped the orb. The browser exercised keyboard skip-link focus, auth error and unauthorized views, fan pending/retry/override, calibration start and abort, charts, missing history metrics, and absent/stale observations. The provider was mocked for those interactions. Real Firebase login, subscription, calibration, CSV transfer and rollback on a live project remain unverified.

## Verification commands

From web/, `npm test` reported **4 files, 43 tests passed**. This includes the 28 previous backend cases with all immutable golden vectors and 15 UI boundary, freshness or archive authorization tests. `npm run typecheck` exited 0. From the repository root, `python3 -m unittest discover -s training -v` ran **5 tests, OK**. `git diff --exit-code phase-4 -- inputs training firmware` exited 0. A separate path and byte comparison verified **65 input files** and every public brand copy.

The normal `NEXT_TELEMETRY_DISABLED=1 npm run build` reached Next.js and failed to fetch Syne from fonts.googleapis.com, including a retry with escalated network access. A direct request returned HTTP 403. For local verification, the ignored firmware/build/phase5 directory held the [official Google Fonts Syne variable TTF](https://github.com/google/fonts/tree/main/ofl/syne) and a local test response for the exact Google CSS URL. The application continues to use next/font/google. The fixture build substitutes only the font-fetch response.

```sh
# From web/, using the local font response file described above.
NEXT_FONT_GOOGLE_MOCKED_RESPONSES=/workspace/Vigil-IIAQ/firmware/build/phase5/font-test.cjs NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
```

Next.js 16.4.6 compiled successfully, generated seven static page entries (including framework entries) and listed all seven dynamic API endpoints. Browser evidence was captured by running `PHASE5_PLAYWRIGHT=/opt/codex/cua_node/lib/node_modules/playwright-core node web/tests/browser.cjs` from the repository root against the local Next dev server with the same Syne response. The temporary app/phase5-fixture/page.tsx re-exported tests/browser-fixture.tsx. After verification the fixture route and generated dev cache were moved out of the application. The browser run printed PASS and captured nine screenshots. The first post-fixture build found stale Next-generated dev types. Moving the dev cache aside cleared the error. No browser testing dependency was added to the project.

The local webpack production server, started with `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3988` from web/, returned HTTP 200 for all five UI routes and the forest logo, HTTP 404 for /phase5-fixture, and HTTP 401 for unauthenticated history, analytics, command and calibration-start requests.

## Files and next phase

web/app contains the shared layout, CSS and five page entries. web/ui contains the page components, Firebase owner provider, status derivation, display bands, theme and shared owner actions. web/src/readback.ts and the optional views in web/src/http.ts expose the existing history, metrics and version data. web/public/brand holds the asset copies. web/tests contains boundary tests and the isolated browser harness. Build configuration and the package lock add the allowed Firebase and Recharts clients. This report and its screenshot folder document the result.

**Phase 6 readiness.** The software and interface can be documented after approval. A normal production build needs access to Google Fonts. Firebase identity, rules and live updates require verification on an authorized project. ESP32 compilation, supervised physical calibration, firmware ingest and fan safety tests, YouTube playback, logo-use permissions and the approved operating/retention budget remain deployment requirements.

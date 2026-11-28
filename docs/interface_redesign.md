# VIGIL interface redesign

## Screenshots

These Chromium captures use the production screen components with labelled synthetic data in an isolated test build. The monitor shows a measured-value field, an approximate occupancy estimate and a predicted CO₂ value. Each comes from its corresponding fixture field.

| Screen | Desktop, 1440 px | Mobile, 390 px |
|---|---|---|
| Owner sign-in | [Desktop sign-in](redesign-screenshots/authentication-1440.png) | [Mobile sign-in](redesign-screenshots/authentication-390.png) |
| Welcome | [Desktop welcome](redesign-screenshots/welcome-1440.png) | [Mobile welcome](redesign-screenshots/welcome-390.png) |
| Room overview | [Desktop monitor](redesign-screenshots/dashboard-1440.png) | [Mobile monitor](redesign-screenshots/dashboard-390.png) |
| Calibration | [Desktop measurement](redesign-screenshots/calibration-1440.png) | [Mobile measurement](redesign-screenshots/calibration-390.png) |
| Analytics | [Desktop details](redesign-screenshots/details-1440.png) | [Mobile details](redesign-screenshots/details-390.png) |
| Settings | [Desktop settings](redesign-screenshots/settings-1440.png) | [Mobile settings](redesign-screenshots/settings-390.png) |

The monitor also has captures at the three intermediate and wide review sizes. [768 px](redesign-screenshots/dashboard-768.png) · [1024 px](redesign-screenshots/dashboard-1024.png) · [1920 px](redesign-screenshots/dashboard-1920.png)

## Composition and interaction

The floating navigation, headline readings and three unequal editorial modules follow the dashboard reference. The five-minute CO₂ trace occupies the widest desktop card. The portrait and caption form one composition on its left. The forest ventilation panel on its right separates the device-reported fan state from the owner’s requested mode. At phone widths, the trace and fan controls appear before the portrait. After reviewing the first browser captures, we raised the portrait crop, aligned the response badges, used lining figures and shortened the mobile details control to an accessible arrow.

The eight source colours match the supplied brief. Ivory provides the main canvas, moss the secondary surfaces and sage the control accent, following the brand’s 60–30–10 hierarchy. Status colours accompany readable text. The four short bars below the CO₂ condition identify its position among the owner-approved bands. Regular-weight Syne, spacing and alignment provide the hierarchy. [Colour tokens](../inputs/brand/colours/colours.json) · [Display bands](../web/ui/bands.ts)

The header persists across owner routes so the active indicator slides between tabs. Device freshness gates the connection animation and fan rotation. The calibration progress bar uses the backend’s measured duration. Chart updates and motion respect the operating system’s reduced-motion preference. Keyboard users can skip to content, navigate all destinations, expand contextual notes and operate the native restore dialog.

The monitor subscribes to the existing owner-readable RTDB buffer while its route is open. It matches the endpoint sequence and capture time to the latest device snapshot, preserves unavailable samples and breaks the line across capture gaps. The history uses device uptime. The separately labelled ten-minute prediction uses the existing backend forecast. When the feed goes stale the current measurements and prediction become unavailable, the last observation time opens and any retained chart is labelled historical. The details screen retains all three target-aligned forecast methods, matched errors, raw diagnostics, fan events and CSV export.

## Assets and permissions

| Supplied material | Web use | Provenance and rights |
|---|---|---|
| Roger_Waters.png, 4000 × 4000 | 1152 × 1152 colour WebP, 107,448 bytes, delivered through Next Image. CSS applies grayscale and positions the crop. The owner’s quotation and attribution appear below the image. | Supplied in Redesign_materials.zip. Its XMP names Canva as the creation tool. The archive contains no photographer credit, rights holder or licence. Obtain the right to publish this photograph and its required credit before public deployment. Roger Waters is the quotation attribution. |
| vigil_logo.png, 2000 × 2000 | The full supplied lockup appears on welcome and sign-in. Crops of its original symbol and lower-case wordmark form the compact signature. The symbol supplies the browser and Apple icon. | Owner-supplied artwork. The original brand kit identifies a third-party reference for the symbol. Public-use permission remains open. |
| Syne | A static Regular 400 WOFF2, 26,020 bytes, derived from the official Google Fonts Syne variable TTF used for prior verification. The owner approved local bundling. | SIL Open Font License 1.1. The original copyright and licence accompany the font. |
| Dashboard reference WebP | Composition, proportion and navigation reference | The reference is confined to design review. |

[Source brand notes](../inputs/brand/README.txt) · [Font licence](../web/public/brand/fonts/OFL.txt) · [Official Syne source](https://github.com/google/fonts/tree/main/ofl/syne)

## Verification

| Command | Actual result |
|---|---|
| From web, `npm test` | 4 files passed, 45 tests passed. Includes the previous 43 cases and two monitor-buffer tests covering listener mismatch, sequence gaps, null readings and the capture boundary. |
| From web, `npm run typecheck` | TypeScript exited 0. |
| From web, `NEXT_TELEMETRY_DISABLED=1 npm run build` | Next.js 16.4.6 Turbopack compiled successfully, completed TypeScript and generated 7 of 7 static entries, including framework entries. It listed all seven dynamic API routes. The build used the bundled font. |
| `python3 -m unittest discover -s training -v` | Ran 5 tests, OK. |
| `PHASE5_PLAYWRIGHT=/opt/codex/cua_node/lib/node_modules/playwright-core node web/tests/browser.cjs` | Six screens passed at each of 390, 768, 1024, 1440 and 1920 px. Saved 15 full-page PNGs. Browser checks verified loaded upright Syne 400, absence of rendered gradients, the decoded grayscale portrait, page width, text bounds, navigation, reduced motion and zero uncaught page errors. |
| From web, `VIGIL_OWNER_UID=synthetic-smoke-owner NEXT_TELEMETRY_DISABLED=1 node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3988` | Local HTTP checks returned 200 for all five page routes and the new icon, 404 for the fixture URL and 401 for unauthenticated calibration status and command requests. |

The test browser exercised sign-in failure and owner denial, keyboard focus, client-side active navigation, missing and stale measurements, requested mode, command retry, local override, calibration start and abort, and the absence of an unsolicited player iframe. CSV download and a confirmed model restore used the isolated provider. An initial browser run caught restore feedback disappearing during the subsequent version-list refresh. The final run verified that the confirmation survives the refresh.

The host firmware regression commands below also passed with the previously installed ArduinoJson headers. The outputs covered command validation and expiry, safety recovery, FIFO replay, acquisition parity, sensor validity, and boot/ACK reply parsing.

```sh
mkdir -p .next/ui-assets
g++ -std=c++17 -Wall -Wextra -Werror firmware/tests/control.cpp -o .next/ui-assets/control
.next/ui-assets/control
python3 firmware/tests/acquisition.py
g++ -std=c++17 -Wall -Wextra -Werror -Ifirmware/build/ArduinoJson-7.4.2/src firmware/tests/reply.cpp -o .next/ui-assets/reply
.next/ui-assets/reply
```

A path-and-byte comparison against phase-6 passed for all 65 immutable input files. Git comparison also passed for firmware, training, server modules, API routes, database rules, schemas and package manifests. Real Firebase sessions, physical sensors and fan operation, external player playback, assistive technology and Safari remain unverified.

## Changed files

| Area | Files |
|---|---|
| App shell and visual language | web/app/layout.tsx, web/app/style.css, web/ui/frame.tsx, icon.tsx, welcome.tsx |
| Screen presentation and owner feedback | web/ui/dashboard.tsx, chart.tsx, details.tsx, calibrate.tsx, settings.tsx, actions.tsx |
| Monitor read path | web/ui/live.tsx, state.ts |
| Assets | web/public/brand/editorial/icon.png, lockup.webp, signature.png, roger-waters.webp, and web/public/brand/fonts/syne-regular.woff2 |
| Tests | web/tests/browser.cjs, browser-fixture.tsx, ui.test.ts |
| Documentation | README.md, docs/cloud_setup.md, windows_setup.md, troubleshooting.md, phase5_ui.md, phase6_verification.md, this report and the 15 linked PNGs |

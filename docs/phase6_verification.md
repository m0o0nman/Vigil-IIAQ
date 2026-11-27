# Phase 6 verification record

Phase 6 began at `0b3afb4`, the approved Phase 5 editorial refinement. This branch is documentation-only. The [integration checklist](integration_checklist.md) contains the unfilled physical results.

## Passed checks

| Check | Observed result |
|---|---|
| In web/, `npm test` | Vitest 4.1.12 reported **4 files passed, 43 tests passed**. The suite uses synthetic golden vectors and mocked Firebase transactions. |
| In web/, `npm run typecheck` | `tsc --noEmit` exited 0. |
| `python3 -m unittest discover -s training -v` | **Ran 5 tests, OK**. |
| C++ `control.cpp`, acquisition parity/gate script and C++ `reply.cpp`, using the commands in the Windows guide | Verified host behavior for command validation, lease expiry, uptime wrap, high/stale/recovery safety, FIFO overflow and duplicate ACK, source acquisition parity, ADC/pulse boundaries and reply parsing. Each returned exit 0. |
| Documented Linux font workaround in the troubleshooting guide | Next.js 16.4.6 webpack compiled successfully, type-checked and listed all five application pages and seven dynamic API endpoints. The font file came from Google's official Syne repository. |
| From web/, `node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3988` with synthetic local settings | HTTP 200 for the home page and forest logo. HTTP 401 for unauthenticated calibration status and ingest. No Firebase connection was attempted. |
| `git diff --exit-code 0b3afb4 -- web firmware inputs training` | Exit 0. A separate comparison checked the set of paths and bytes for all **65** input files. |

A documentation check resolved 52 relative file links and confirmed 21 integration rows with blank physical results. Phase 5 Chromium screenshots and interaction tests remain evidence for synthetic UI behavior. The Windows commands were checked against the actual paths, scripts and lockfile. This host has no PowerShell executable. Windows setup and IDE steps remain to be exercised on the target workstation. [Windows setup commands](windows_setup.md) · [Browser evidence](phase5_ui.md#browser-evidence)

## Unresolved checks

### Normal Next.js production build

From web/, `NEXT_TELEMETRY_DISABLED=1 npm run build` exited 1 with `Failed to fetch Syne from Google Fonts`. A direct fetch of the configured CSS endpoint returned HTTP 403. The local workaround substitutes a test response containing the official font for the build fetch, while keeping the application's `next/font/google` configuration. Run the normal command on the authorized builder before release. [Exact workaround](troubleshooting.md#syne-and-build-access)

### ESP32 target build

From the repository root the repository-local Arduino CLI used an ignored configuration with isolated data and sketchbook directories:

```sh
firmware/build/tools/arduino-cli core update-index --config-file firmware/build/tools/cli.yaml
firmware/build/tools/arduino-cli compile --config-file firmware/build/tools/cli.yaml --fqbn esp32:esp32:nodemcu-32s firmware/VigilV2
```

Index fetches failed on DNS for downloads.arduino.cc and espressif.github.io, including a retry with escalated network access. The compile attempt exited 1 before reading the sketch:

```text
Error during build: Platform 'esp32:esp32' not found: platform not installed
Platform esp32:esp32 is not found in any known index
```

Target binaries, target resource use and hardware behavior remain unverified. [Arduino IDE steps](esp32_setup.md#compile-and-upload-in-arduino-ide-2-on-windows)

### Quotas and deployment

Direct fetches of the official Firestore quota, Firebase pricing, Firebase CLI and Vercel Hobby pages returned HTTP 403. The deployment runbook uses the owner-verified Phase 4 limits and clearly identifies estimates. Actual Firebase authentication, rules, transaction behavior, Vercel packaging/runtime, ESP32 network and TLS behavior, and physical fan response remain to be tested. No cloud project or deployment was created or modified in Phase 6. [Quota estimates and release procedure](cloud_setup.md)

## Acceptance sequence

1. Transfer the approved commit to the Windows workstation, verify its identity and compile the target sketch using the documented versions.
2. Verify the assembly, acquisition timing and local fan safety with a safe test load. Confirm original pin routing and inspect the actual driver circuit before applying motor power.
3. With separate authorization, configure an isolated Firebase project and deploy the approved commit to Vercel. Run the normal production build, verify cloud authorization and confirm one supervised ingest-to-ACK cycle.
4. Complete the [integration checklist](integration_checklist.md), then collect independent [experimental evidence](experimental_validation.md) under the approved usage budget. Record physical results, actual quotas and storage use.

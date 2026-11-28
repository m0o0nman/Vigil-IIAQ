# Troubleshooting

| Symptom | Checks and recovery |
|---|---|
| ESP32 target platform missing or legacy ADC API errors | Use Arduino IDE 2 Boards Manager with the official ESP32 URL and core **2.0.17**. Select **NodeMCU-32S** and verify the full sketch directory. In the cloud, DNS/index failures prevent installation. Retry on a trusted network where Arduino and Espressif indexes are available. |
| Sensirion or ArduinoJson header missing | Install **Sensirion I2C SCD4x 1.1.0**, its **Sensirion Core** dependency and **ArduinoJson 7.4.2** through Library Manager. Read the compiler output if duplicate library installations select a different version. |
| COM port missing or upload stalls | Check the USB data cable, USB-UART driver and Device Manager port. Close other serial clients and select the board's COM port. If required, follow the verified board's BOOT/EN procedure. Keep the fan load isolated and leave erase-all-flash disabled. |
| Provisioning portal missing | Check 115200 baud serial for the temporary AP notice. A device with saved working credentials joins as a station. With no credentials or after the connection-failure timeout, join the named setup AP with its current password. Open the setup AP gateway if the browser does not open the captive form. |
| Station rejects credentials | Confirm network SSID, security and reachability with the board documentation and operator. Submit on the actual setup AP and wait for reconnection. Use a freshly loaded form after the portal restarts. |
| HTTPS fails before HTTP | Verify DNS, SNTP clock, exact hostname, direct endpoint URL, chain expiration and the public root compiled into site_config.h. Rebuild after a trust or hostname change. Keep certificate verification enabled. |
| Ingest returns 401 | Verify the server-side device secret and the ESP32 provisioned value match exactly, including case. Confirm the request sends `X-Device-Secret` and reaches the app rather than an upstream authentication screen. |
| Ingest returns 400, 409 or 503 | Check the exact JSON and required flags on 400. On 409 investigate a sequence conflict, missing predecessor or wrong session. On 503 check Firebase access, active pointers and service configuration. Preserve captures and compare boot/seq across retries. |
| Owner can sign in but live access is denied | Verify the runtime UID, Firebase project/auth domain and both database URLs. Check the current RTDB rules and owner mapping created by an authorized projection. A nonowner is expected to receive 403 from owner APIs and permission denied from RTDB. Avoid opening the rules as a workaround. |
| API reports missing server configuration | Compare deployed values with the environment map. Check for empty or malformed JSON, a truncated private key and cross-project credentials. Public settings are build-time inputs and changes require a rebuild. |
| Vercel build cannot resolve training specs or colours | Set project root to `web` and include repository files above that root. Use the approved release commit, Node 24, `npm ci` and `npm run build`. Confirm the complete project checkout. |
| UI shows unavailable or stale data | Check that the ESP32 is generating Sharp aggregates, since the queue is driven by that capture worker. Verify upload ACK, RTDB revision, `/live/latest`, boot identity, receipt time and sensor flags. Inspect MQ warm-up, SCD age and Sharp validity separately. A stale device cannot be made current by replaying a capture. |

[ESP32 procedure](esp32_setup.md) · [Cloud environment map](cloud_setup.md#environment-variable-map) · [Firmware response contract](../firmware/README.md#upload-and-command-contract)

## Syne and build access

The normal build retrieves Syne through `next/font/google`. From Windows, check the exact CSS URL with PowerShell and verify access to the referenced font host from the build network:

```powershell
Invoke-WebRequest -Uri 'https://fonts.googleapis.com/css2?family=Syne:wght@400..800&display=swap'
```

If access is blocked, use an authorized network or HTTPS proxy that can reach `fonts.googleapis.com` and `fonts.gstatic.com`. Set the platform-provided trusted `HTTPS_PROXY` URL if the network administrator supplies one. Keep TLS verification enabled. Retry the normal `npm.cmd run build` on Windows or in the intended Vercel project after establishing access.

A **local verification workaround** uses Next's test-response hook with the official Syne variable TTF. Run this in Linux or WSL from the repository root, with web dependencies installed. The hook and font file belong in ignored build storage. Use the normal font-fetch path for a release.

```sh
mkdir -p firmware/build/phase6-font
curl -fLsS 'https://raw.githubusercontent.com/google/fonts/main/ofl/syne/Syne%5Bwght%5D.ttf' -o firmware/build/phase6-font/Syne.ttf
cat > firmware/build/phase6-font/font-test.cjs <<'JS'
const path = require('node:path')
const font = path.join(__dirname, 'Syne.ttf')
module.exports = {
  'https://fonts.googleapis.com/css2?family=Syne:wght@400..800&display=swap':
    "/* latin */\n@font-face { font-family: 'Syne'; font-style: normal; font-weight: 400 800; font-display: swap; src: url(" +
    font + ") format('truetype'); }",
}
JS
(
  cd web
  NEXT_FONT_GOOGLE_MOCKED_RESPONSES="$(realpath ../firmware/build/phase6-font/font-test.cjs)" \
    NEXT_TELEMETRY_DISABLED=1 npm run build -- --webpack
)
```

The Phase 6 normal build failed because the Google Fonts endpoint returned HTTP 403 in this environment. The verification record distinguishes the local workaround from the normal build and deployment. [Official Syne source](https://github.com/google/fonts/tree/main/ofl/syne) · [Next.js font guide](https://nextjs.org/docs/app/getting-started/fonts) · [Build evidence](phase6_verification.md)

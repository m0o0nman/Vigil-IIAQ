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

The redesigned interface loads the bundled Syne Regular WOFF2 through `next/font/local`. If the font is missing during compilation, check that the builder has the tracked asset at `web/public/brand/fonts/syne-regular.woff2` and the matching source path in `web/app/layout.tsx`. Run `npm run build` from `web`. Chromium’s Network panel should show a successful same-origin request under `/_next/static/media/`. The earlier Phase 5 and 6 builds used a Google Fonts test response. [Official Syne source](https://github.com/google/fonts/tree/main/ofl/syne) · [Redesign verification](interface_redesign.md)

# VIGIL firmware v2 · Phase 2 handoff

Open `VigilV2/VigilV2.ino` as the Arduino sketch. Acquisition and local safety run independently of provisioning and upload. The ESP32 captures raw observations and drives the fan. There is no local trained model, forecast, dashboard, or permanent development AP. The existing Phase 1 specs and fixtures remain the server handoff.

## Wiring and acquisition parity

F denotes [the immutable ESP32 sketch](../inputs/code/VIGIL_Phase3_Fixed.ino). Numeric hardware settings below come from the indicated lines.

| Circuit | Connection and preserved behavior | Source |
|---|---|---|
| SCD40 | SDA GPIO21, SCL GPIO22, 100 kHz I²C, address 0x62. Stop periodic measurement, wait 500 ms, restart. Poll ready at most once per 1000 ms. Reject read error, zero CO₂, nonfinite T/RH or humidity outside 0–100%. Previous good reading remains available for 30 s and usable for control through 15 s inclusive. | F18,27,285–291,339–345 |
| MQ135 | GPIO34, 12-bit ADC. Start at 0 dB. Average 20 raw/mV pairs between Sharp pulses when >3000 µs remain. At mean raw ≥3900 retry at 11 dB. Discard first conversion after attenuation changes. Reconstruct AO = 2 × GPIO voltage, and Rs in kΩ = 1 × (5/AO − 1). Require 2 < raw < 4090 and 0 < AO < 5 V. Fresh through 1500 ms. | F18–19,153–154,180–194,295,342 |
| Sharp | GPIO35 analog, GPIO27 LED, active HIGH. ADC1, 11 dB, 12 bits, 1100 mV calibration reference, divider ×2. Period 10000 µs. Read OFF, raise LED, start ON sample at 280 µs, lower after 320 µs. Accept nonrail ON, width 300–340 µs and sample offset 280–300 µs inclusive. Convert after LED LOW. | F18–19,30,149–172,339–344 |
| Sharp aggregates | Emit every 100 attempted pulses. Require ≥95 good ON pulses, no missed periods and finite ON ≥1015.76/2 mV. Average valid OFF independently. Preserve ON even if OFF and delta are missing. Record min/max width, missed periods and rejected ON count. Fresh through 2500 ms. The producer also records invalid aggregates. | F31,160–179,293 |
| Fan | GPIO25 active HIGH, LOW at startup. Safety uses SCD40 only. | F18,25–27,204–230,242,339 |
| Scheduling | ADC worker retains the original 4096-byte stack, priority 2, core 1 and yields. The pulse contains no network, JSON, I²C, heap allocation or serial calls. Serial link 115200 baud. | F146–199,340,350 |

The host comparison checks the entire ADC worker with two explicit changes: saving the MQ raw average and publishing a record after each Sharp aggregate. SCD40 read errors remain visible while the previous sample ages. The snapshot includes both latest MQ and the MQ sample paired with the last successful SCD40 read. No local MQ warm-up filter removes raw telemetry. Backend inference must apply the Phase 1 readiness gates. The optional legacy MQ reference is read from the original NVS keys (F98–109); validate the signature, finite values and coverage in Phase 3 before accepting it.

## Upload and command contract

POST to the operator-configured HTTPS URL ending in `/api/ingest`, with `Content-Type: application/json` and a provisioned `X-Device-Secret`. Each record is an observation at capture time. Here is a **synthetic** one-record envelope.

```json
{
  "boot_id": "00112233445566778899aabbccddeeff",
  "command_eligible": true,
  "dropped_total": 0,
  "legacy_mq_reference": null,
  "records": [{
    "seq": 6, "uptime_ms": 6002,
    "sharp": {"seq":6,"at_ms":6002,"valid":true,"fresh":true,"on_mv":1458.52,"off_mv":null,"delta_mv":null,"min_pulse_us":321,"max_pulse_us":326,"rejected":0,"missed":0},
    "mq135": {"seq":28,"at_ms":5900,"valid":true,"fresh":true,"adc_raw":700,"gpio_v":0.7,"ao_v":1.4,"rs_kohm":2.571429},
    "mq_at_scd": {"seq":24,"at_ms":5000,"valid":true,"fresh":true,"adc_raw":700,"gpio_v":0.7,"ao_v":1.4,"rs_kohm":2.571429},
    "scd40": {"at_ms":5100,"valid":true,"control_fresh":true,"error":"ok","co2_ppm":610,"temperature_c":25,"rh_pct":75},
    "fan_on":false,"fan_reason":"no_command","local_override":false
  }]
}
```

- Authenticate the device and deduplicate by its registered identity, boot_id and record seq. A random 128-bit boot identifier starts a new session. Record seq starts at one and is 64-bit. All millisecond clocks and sensor sequence counters are unsigned 32-bit. Use modular differences within a boot; repeated SCD timestamps identify held samples. Use capture times for history and command eligibility, independent of receipt time. For MQ inference use mq_at_scd once per fresh SCD sample. Its freshness is relative to the SCD read.
- Numbers may be null when the sensor supplies no finite value. Validity and freshness take precedence over numeric presence. SCD error is the most recent acquisition outcome (waiting, init_failed, ready_failed, invalid_measurement, ok). If no new SCD measurement arrives, age continues increasing. ADC startup failure is reported on serial; without Sharp aggregates there is no upload heartbeat. Treat loss of uploads as offline. A legacy reference, when present, contains model_sig, r0, x0, t0, h0.
- Process every Sharp aggregate in sequence, retaining invalid rows as filter resets. Detect missing records from seq gaps or FIFO evictions. Mark discontinuities before resuming model state. Losses must not be filled with repeated values. Never advance live state backward on duplicate or late uploads.
- Respond with HTTP 200, explicit Content-Length of 1–512 bytes, uncompressed JSON and no redirects. Echo the boot and last seq in this request only after durably accepting all its records or recognizing duplicates. Example: `{"boot_id":"00112233445566778899aabbccddeeff","ack_seq":6,"mode":"auto","fan_cmd":"on","fan_seconds":10}`. Return canonical ASCII keys/string values without escape sequences, and unsigned integer numeric fields. The device validates the ACK separately from the command. Wrong boot/seq, truncated body or invalid JSON retains queued data for retry.
- Allowed combinations are auto/on, auto/off, off/off and freshen/on. An ON command requires positive integral seconds. A zero-duration OFF revokes a lease. Duration must fit a 32-bit millisecond interval. Send only the remaining authorization time. Recalculate on retries; never renew an expired user command from a cached response. The device starts the lease clock at request start, so transit consumes its lifetime. A historical batch may receive an ACK without a command. Only a batch extending through the queue tail at copy time with a newest record ≤5 s old is eligible, and that record must still be ≤15 s old when applying the reply.
- Failed requests, malformed commands, loss of station connectivity, replay-only replies and lease expiry clear remote authority. A blocking network operation may run until its timeout; the sensor loop enforces the previously accepted lease expiry throughout.

## Safety decision table

First matching row controls the pin. The owner approved retaining minimum-runtime and recovery after a high reading. That latch starts when fresh high CO₂ first triggers safety, including when a backend lease already had the fan on.

| Input or state | Fan | Reason |
|---|---|---|
| No valid CO₂ or latest age >15000 ms | OFF immediately, clear safety latch | stale_co2 |
| Fresh CO₂ ≥1000 ppm starts latch, elapsed <120000 ms | ON | minimum_runtime |
| Latched, minimum elapsed, CO₂ ≥750 ppm | ON, cancel recovery | co2_hold |
| Latched, minimum elapsed, continuous fresh CO₂ <750 ppm for <180000 ms | ON | recovery |
| Minimum and recovery both complete | Release latch; apply current lease | backend or no_command |
| Unlatched, fresh CO₂, valid unexpired lease | Commanded state | backend |
| Unlatched, fresh CO₂, no usable lease | OFF | no_command |

Only distinct SCD sample timestamps advance recovery. A gap beyond control freshness interrupts recovery. A stale high value cannot override stale-OFF. Source: F25–27,204–230,245–251. Preventive forecast votes belong to the old policy; model-based fan decisions move off-device. The fallback OFF state follows the original standby/boot behavior (F233–242,339).

## RAM, network and provisioning

The following queue and transport sizes are Phase 2 engineering choices. A statically allocated FIFO retains 120 aggregates (nominally two minutes). Enqueue takes a short critical section after the pulse ends. The network task on core 0 copies up to ten records while locked, then releases the lock before serialization, TLS and HTTP. FIFO memory is 120 × sizeof(Record) plus bookkeeping; the static upload snapshot adds ten records. Budget separately for JSON, the serialized body, TLS, Wi-Fi and a 12288-byte network stack. Actual headroom requires an ESP32 build and profiling.

The oldest record is evicted on overflow. dropped_total counts evictions, including a record already copied into an in-flight batch. Final ack_seq removes only matching-or-earlier records. RAM loss on reset is permanent and the next boot ID distinguishes it. The normal upload interval is five seconds. Pending full batches drain immediately after success. On failure retry after five seconds. Both HTTP connect/read settings are five seconds; DNS, TLS and portal latency are separate. No network call holds the sensor lock.

The station tries saved credentials first. With none, or after 30 seconds of connection failure, it opens the temporary VIGIL-Setup AP and wildcard DNS portal. Read its fresh random WPA password from USB serial. The form collects SSID, Wi-Fi password and device secret, uses an AP-interface check and per-activation form nonce, and saves them together to the separate vigil-net NVS namespace. Successful station connection shuts down DNS and HTTP. Protect physical serial access and flash; this prototype does not configure flash encryption. TLS uses the configured CA and hostname, with SNTP for certificate dates. Missing configuration disables upload. Keep the original vigil_ml NVS namespace through flashing.

## Compile in Arduino IDE 2

1. Under **File → Preferences → Additional Boards Manager URLs**, add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. In Boards Manager install **esp32 by Espressif Systems 2.0.17**. This build target retains the legacy esp_adc_cal and attenuation API used by the original sketch. Select **Tools → Board → esp32 → NodeMCU-32S** (F1–3, F342–345). Leave erase-all-flash disabled.
2. In Library Manager install **Sensirion I2C SCD4x 1.1.0** and accept its **Sensirion Core** dependency. Install **ArduinoJson 7.4.2**. Wire, WiFi, WiFiClientSecure, HTTPClient, WebServer, DNSServer, Preferences, FreeRTOS and esp_adc_cal come with the ESP32 platform. The manufacturer board listing, Sensirion ready-status API and ArduinoJson library version were checked against their upstream release files. [Espressif board list](https://github.com/espressif/arduino-esp32/blob/2.0.17/boards.txt) · [Sensirion header](https://github.com/Sensirion/arduino-i2c-scd4x/blob/1.1.0/src/SensirionI2cScd4x.h) · [ArduinoJson release](https://github.com/bblanchon/ArduinoJson/tree/v7.4.2)
3. Open `firmware/VigilV2/VigilV2.ino` and select **Sketch → Verify/Compile**. An absent site_config.h builds the offline acquisition configuration. For a later integration build, create the ignored `firmware/VigilV2/site_config.h` with these two declarations, replacing the illustrative URL and PEM text with the intended endpoint and its actual trusted **public root**:
   ```cpp
   #pragma once
   static const char INGEST_URL[] = "https://example.invalid/api/ingest";
   static const char ROOT_CA[] = R"PEM(REPLACE_WITH_PUBLIC_ROOT_CA_PEM)PEM";
   ```
   Device secrets and Wi-Fi credentials enter through provisioning. Never put a private key in the header. Hardware upload and backend integration are separate later checks.

## Actual verification

From the repository root:

```sh
mkdir -p firmware/build
g++ -std=c++17 -Wall -Wextra -Werror firmware/tests/control.cpp -o firmware/build/control
firmware/build/control
python3 firmware/tests/acquisition.py
curl -fLsS https://codeload.github.com/bblanchon/ArduinoJson/tar.gz/refs/tags/v7.4.2 -o firmware/build/arduinojson.tgz
tar xzf firmware/build/arduinojson.tgz -C firmware/build
g++ -std=c++17 -Wall -Wextra -Werror -Ifirmware/build/ArduinoJson-7.4.2/src firmware/tests/reply.cpp -o firmware/build/reply
firmware/build/reply
python3 -m unittest discover -s training -v
git diff phase-1 --exit-code -- inputs
```

Observed outputs:

```text
PASS command validation, lease expiry and uptime wrap
PASS high, stale, minimum runtime, rebound and sustained recovery
PASS bounded FIFO, retry, in-flight overflow and duplicate ACK
PASS complete ADC worker matches original apart from two telemetry changes
PASS Sharp rail, pulse, aggregate validity and MQ voltage/ADC boundaries
PASS ArduinoJson reply decoding, boot/ACK binding, types and malformed commands
Ran 5 tests
OK
```

Both host executables and the acquisition checks exited 0. The inputs diff exited 0. FIFO tests simulate transport loss followed by replay and ACK; radio reassociation and real I/O have not been exercised.

A repository-local Arduino CLI 1.3.1 was obtained from the official GitHub release. `firmware/build/tools/arduino-cli core update-index --config-file firmware/build/tools/cli.yaml` failed on index DNS resolution including on retry. Fetches through the available HTTP proxy returned 403. The config directed downloads, data and sketchbook into ignored firmware/build/. The attempted build was:

```sh
firmware/build/tools/arduino-cli compile --config-file firmware/build/tools/cli.yaml --fqbn esp32:esp32:nodemcu-32s firmware/VigilV2
```

Exit 1: **Platform 'esp32:esp32' not found: platform not installed**. No ESP32 binary, target memory figures or board-level compilation result is available.

## Hardware checks still required

- [ ] Compile the complete sketch using the target above. Record binary size, static RAM and free heap/stack under TLS and queue pressure.
- [ ] Confirm pin wiring, common ground, divider voltages, fan driver polarity and boot OFF on the actual assembly. Check SCD ready/error and fresh/stale boundaries by disconnecting and restoring the sensor.
- [ ] Scope LED pulse and sample offset under simultaneous upload, reconnect and captive-portal load. Compare pulse extrema, rejected and missed counts, MQ range switching and Sharp OFF-null behavior with the original firmware.
- [ ] Exercise absent/bad credentials, AP password and nonce, provisioning, successful station reconnect and portal shutdown. Verify valid TLS passes and wrong hostname, untrusted or expired CA, bad clock and unauthorized requests all fail closed.
- [ ] With an authorized test endpoint in a subsequent phase, verify every aggregate, deduplication after lost ACK, overflow counts, ordered drain, independent boot IDs and handling of invalid rows. Reset during outage and confirm a visible discontinuity.
- [ ] Check high-CO₂ override against remote OFF, minimum runtime and sustained recovery, stale override against remote ON, command expiry, malformed replies and an unreachable backend. Verify the physical pin with a supervised load.

**Phase 3 readiness.** The contract and host-tested decision logic are ready for backend design after approval. A successful target build, physical acquisition parity and authenticated device round trip remain prerequisites for declaring the firmware integration verified.

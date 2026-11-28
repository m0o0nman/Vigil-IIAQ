# ESP32 wiring, build and provisioning

Use the classic ESP32 **NodeMCU-32S**. Reference **F** is the original approved firmware in inputs/code/VIGIL_Phase3_Fixed.ino. Verify wiring with the actual project assembly and sensor documentation before supplying power. The firmware identifies logical signals and ADC reconstruction. The provided files leave the complete electrical schematic and driver ratings unspecified.

## Wiring table

| Assembly signal | ESP32 connection | Approved acquisition behavior and electrical boundary | Source |
|---|---|---|---|
| SCD40 SDA | GPIO21 | I²C at 100 kHz, device address 0x62 | F18,345 |
| SCD40 SCL | GPIO22 | Same bus. Verify breakout supply, logic and pull-ups from its documentation. | F18,345 |
| MQ135 analog signal | GPIO34, ADC1 input | Connect the output of the verified divider. Firmware assumes AO = 2 × GPIO voltage, 5 V in the Rs calculation and a 1 kΩ load value. These values describe reconstruction. Verify the actual circuit and heater supply separately. | F18–19,180–194,342 |
| Sharp GP2Y1010AU0F analog output | GPIO35, ADC1 input | Connect the verified divided analog signal. Firmware reconstructs sensor millivolts using a factor of 2, 12-bit ADC, 11 dB attenuation and a 1100 mV calibration reference. | F18–19,162–179,342–344 |
| Sharp LED control | GPIO27 | Active HIGH logic at the GPIO, initialized LOW. Verify the existing LED interface and its polarity. The code uses 10,000 µs periods, nominal ON sample at 280 µs, nominal pulse width 320 µs. | F18,30,146–179,339 |
| Fan driver control | GPIO25 | Active HIGH logic, initialized LOW. The signal goes to the verified driver input. Motor current requires a rated switching stage and supply. Inspect the existing driver, motor specifications and transient protection before connection. | F18,242,339 |
| Power and ground | Board and module power terminals per the actual assembly | Use rated supplies. The ESP32 and ground-referenced sensor/driver signals need a common reference. Confirm any isolation topology before joining supplies. Verify voltage limits at the GPIOs and supply behavior with the fan starting. | Connection topology and component ratings are absent from F. |

The firmware sets MQ135 attenuation to 0 dB for each initial range. Measurements with average raw ADC ≥3900 retry at 11 dB. The Sharp pulse validator accepts width 300–340 µs and sample offset 280–300 µs. Each group of 100 attempted pulses needs at least 95 good ON conversions, zero missed periods and a finite ON value above the firmware minimum. A missing OFF reading can coexist with a valid ON reading. [Original acquisition lines](../inputs/code/VIGIL_Phase3_Fixed.ino:149) · [Firmware parity and telemetry](../firmware/README.md)

## Compile and upload in Arduino IDE 2 on Windows

1. Install Arduino IDE 2 and use a USB data cable. Install the USB-UART driver for the chip fitted to the actual board if Device Manager does not expose a COM port.
2. In **File → Preferences → Additional Boards Manager URLs**, add `https://espressif.github.io/arduino-esp32/package_esp32_index.json`. In **Tools → Board → Boards Manager**, install **esp32 by Espressif Systems 2.0.17**. Under **Tools → Board → esp32**, select **NodeMCU-32S**. Keep the selected board's defaults and leave erase-all-flash disabled to preserve NVS.
3. In **Library Manager**, install **Sensirion I2C SCD4x 1.1.0** and its **Sensirion Core** dependency. Install **ArduinoJson 7.4.2**. The ESP32 core supplies Wire, WiFi, WiFiClientSecure, HTTPClient, WebServer, DNSServer, Preferences, FreeRTOS and `esp_adc_cal`.
4. Open `firmware\VigilV2\VigilV2.ino`. For an offline acquisition build leave `site_config.h` absent. Select **Sketch → Verify/Compile** and record the exact board and library versions plus reported flash and RAM sizes. Complete the authorized upload only after the target build passes and the fan load is physically made safe.
5. For a network build, create the ignored sibling file `firmware\VigilV2\site_config.h`. Use the actual authorized HTTPS origin and a trusted public root CA certificate in PEM format. Obtain and verify that root through the deployment operator and the issuer's authenticated publication. Confirm the hostname's certificate chain, expiration and hostname from a trusted workstation. The device verifies TLS and synchronizes time via SNTP.

   ```cpp
   #pragma once
   static const char INGEST_URL[] = "https://replace-with-verified-host.invalid/api/ingest";
   static const char ROOT_CA[] = R"PEM(REPLACE_WITH_TRUSTED_PUBLIC_ROOT_CA_PEM)PEM";
   ```

   Place a public trust anchor in this header. Wi-Fi and device secrets are configured during provisioning.
6. In **Tools → Port**, select the board's COM port. Close software holding the port. Press **Upload**. If automatic bootloader entry fails, check the board manufacturer's BOOT/EN procedure. Reopen **Serial Monitor** at **115200 baud** after upload. Record startup diagnostics privately. Local-only Firmware v2 does not stream the legacy serial JSON sensor log.
7. With no usable saved credentials, connect the workstation to **VIGIL-Setup** using the temporary WPA password printed over USB serial. If the captive page does not open, navigate to the setup AP gateway shown by Windows network details. Enter the experiment Wi-Fi SSID and password and the device secret matching server-side `VIGIL_DEVICE_SECRET`. The temporary portal uses local HTTP on its secured AP. Protect the serial output and enter credentials only on the intended AP. The sketch stores the settings in `vigil-net` NVS and shuts down the portal when station Wi-Fi connects. Retain the existing `vigil_ml` namespace.
8. Check device time synchronization, DNS and direct HTTPS connectivity to the configured endpoint. Confirm ingest and live readings with the ordered checklist. Invalid trust, hostname or clock must fail closed. Protect physical access to flash because this prototype does not configure flash encryption. [Firmware provisioning and replay](../firmware/README.md#ram-network-and-provisioning) · [Integration checklist](integration_checklist.md)

The cloud Arduino CLI attempt stopped before compiling the sketch because the board platform was unavailable. The Arduino IDE sequence remains to be exercised with the actual board. [Exact Phase 6 build evidence](phase6_verification.md)

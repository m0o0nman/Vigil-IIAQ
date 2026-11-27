#include "device.h"
void setup() {
  Serial.begin(115200);
  if (!beginSensors()) Serial.println("ADC task failed: telemetry unavailable");
  if (xTaskCreatePinnedToCore(networkWorker,"network",12288,nullptr,1,nullptr,0)!=pdPASS)
    Serial.println("Network task failed: local safety only");
}
void loop() { serviceSensors(); delay(1); }

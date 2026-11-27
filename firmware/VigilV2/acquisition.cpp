#include "device.h"
#include <Wire.h>
#include <SensirionI2cScd4x.h>
#include <esp_adc_cal.h>
// Acquisition port from inputs/code/VIGIL_Phase3_Fixed.ino:18-19,30-31,146-199,285-291,338-350.
constexpr int SDA_PIN=21,SCL_PIN=22,MQ_PIN=34,DUST_PIN=35,LED_PIN=27,FAN_PIN=25;
constexpr float MQ_VCC=5.0f,MQ_RL=1.0f,DIVIDER=2.0f,DUST_LOW=1015.76f;
constexpr uint32_t DUST_PERIOD_US=10000,DUST_SAMPLE_US=280,DUST_PULSE_US=320;
static SensirionI2cScd4x scd40;
static esp_adc_cal_characteristics_t dustCal;
portMUX_TYPE dataMux=portMUX_INITIALIZER_UNLOCKED;
Ring<Record,120> backlog;
static MQReading mqShared{};
static Climate climate{};
static MQReading mqAtScd{};
static Lease lease{};
static Safety safety{};
static FanDecision fan{false,"stale_co2"};
static uint64_t sequence=0;
static bool scdInit=false;
static uint32_t lastPoll=0;

static void capture(const DustReading& dust) {
  portENTER_CRITICAL(&dataMux);
  backlog.append({++sequence,(uint32_t)millis(),dust,mqShared,climate,mqAtScd,fan});
  portEXIT_CRITICAL(&dataMux);
}

void setLease(Lease next) {
  portENTER_CRITICAL(&dataMux); lease=next; portEXIT_CRITICAL(&dataMux);
}

void adcWorker(void*){
  uint32_t next=micros()+DUST_PERIOD_US,seq=0,mqSeq=0;
  uint16_t count=0,bad=0,missed=0,good=0,offGood=0,minP=65535,maxP=0;
  float onSum=0,offSum=0;
  uint32_t mqRawSum=0,mqMvSum=0;uint8_t mqN=0;bool mqHighRange=false;
  analogSetPinAttenuation(MQ_PIN,ADC_0db);(void)analogRead(MQ_PIN);
  for(;;){
    int32_t remaining=(int32_t)(next-micros());
    if(remaining>2000){vTaskDelay(1);continue;}
    if(remaining>0)delayMicroseconds((uint32_t)remaining);
    uint32_t nowUs=micros();uint32_t late=nowUs-next;
    if(late>=DUST_PERIOD_US){uint32_t skipped=late/DUST_PERIOD_US;missed=(uint16_t)(skipped>65535UL-missed?65535UL:missed+skipped);next+=skipped*DUST_PERIOD_US;}
    next+=DUST_PERIOD_US;
    int offRaw=analogRead(DUST_PIN);
    digitalWrite(LED_PIN,HIGH);uint32_t start=micros();
    while((uint32_t)(micros()-start)<DUST_SAMPLE_US){}
    uint32_t sampleAt=micros()-start;int onRaw=analogRead(DUST_PIN);
    while((uint32_t)(micros()-start)<DUST_PULSE_US){}
    digitalWrite(LED_PIN,LOW);uint32_t width=micros()-start;
    if(width<minP)minP=(uint16_t)width; if(width>maxP)maxP=(uint16_t)(width>65535UL?65535UL:width);
    bool goodOn=onRaw>0&&onRaw<4095&&width>=300&&width<=340&&sampleAt>=280&&sampleAt<=300;
    if(goodOn){onSum+=DIVIDER*esp_adc_cal_raw_to_voltage(onRaw,&dustCal);good++;}else bad++;
    if(offRaw>0&&offRaw<4095){offSum+=DIVIDER*esp_adc_cal_raw_to_voltage(offRaw,&dustCal);offGood++;}
    count++;
    if(count==100){
      DustReading d={};d.seq=++seq;d.at=millis();d.on=good?onSum/good:NAN;d.off=offGood?offSum/offGood:NAN;d.delta=d.on-d.off;
      d.rejected=bad;d.missed=missed;d.minPulse=minP;d.maxPulse=maxP;
      d.valid=good>=95&&missed==0&&isfinite(d.on)&&d.on>=DUST_LOW*.5f;
      capture(d);
      count=bad=missed=good=offGood=maxP=0;minP=65535;onSum=offSum=0;
    }
    // Same original two-range MQ method, spread across dust periods.
    if((int32_t)(next-micros())>3000){
      mqRawSum+=analogRead(MQ_PIN);mqMvSum+=analogReadMilliVolts(MQ_PIN);mqN++;
      if(mqN==20){
        float raw=mqRawSum/20.0f;
        if(!mqHighRange&&raw>=3900){mqHighRange=true;analogSetPinAttenuation(MQ_PIN,ADC_11db);(void)analogRead(MQ_PIN);}
        else {
          MQReading m={};m.seq=++mqSeq;m.at=millis();m.raw=raw;m.pinV=mqMvSum/20000.0f;m.aoV=m.pinV*DIVIDER;
          m.valid=raw>2&&raw<4090&&m.aoV>0&&m.aoV<MQ_VCC;
          m.rs=m.valid?MQ_RL*(MQ_VCC/m.aoV-1):NAN;
          portENTER_CRITICAL(&dataMux);mqShared=m;portEXIT_CRITICAL(&dataMux);
          mqHighRange=false;analogSetPinAttenuation(MQ_PIN,ADC_0db);(void)analogRead(MQ_PIN);
        }
        mqN=0;mqRawSum=mqMvSum=0;
      }
    }
    // Yield even if delayed; timing failures are reported, never hidden.
    vTaskDelay(1);
  }
}

bool beginSensors() {
  pinMode(FAN_PIN,OUTPUT); digitalWrite(FAN_PIN,LOW);
  pinMode(LED_PIN,OUTPUT); digitalWrite(LED_PIN,LOW);
  pinMode(MQ_PIN,INPUT);pinMode(DUST_PIN,INPUT);analogReadResolution(12);
  analogSetPinAttenuation(DUST_PIN,ADC_11db);analogSetPinAttenuation(MQ_PIN,ADC_0db);
  (void)analogRead(DUST_PIN);
  esp_adc_cal_characterize(ADC_UNIT_1,ADC_ATTEN_DB_11,ADC_WIDTH_BIT_12,1100,&dustCal);
  Wire.begin(SDA_PIN,SCL_PIN);Wire.setClock(100000);scd40.begin(Wire,0x62);
  scd40.stopPeriodicMeasurement();delay(500);scdInit=scd40.startPeriodicMeasurement()==0;
  climate.error=scdInit?"waiting":"init_failed";
  return xTaskCreatePinnedToCore(adcWorker,"ADC",4096,nullptr,2,nullptr,1)==pdPASS;
}

void serviceSensors() {
  uint32_t now=millis();
  // Only this loop writes the climate and fan snapshot.
  Climate c=climate;
  MQReading paired{};
  bool accepted=false;
  if (c.valid && now-c.at>30000UL) c.valid=false;
  if (scdInit && now-lastPoll>=1000UL) {
    lastPoll=now;
    bool ready=false;
    if (scd40.getDataReadyStatus(ready)) c.error="ready_failed";
    else if (ready) {
      uint16_t ppm=0; float t=NAN,h=NAN;
      if (scd40.readMeasurement(ppm,t,h) || !ppm || !isfinite(t) || !isfinite(h) || h<0 || h>100)
        c.error="invalid_measurement";
      else {
        portENTER_CRITICAL(&dataMux);
        c={(uint32_t)millis(),ppm,t,h,true,"ok"};
        paired=mqShared;
        portEXIT_CRITICAL(&dataMux);
        accepted=true;
      }
    }
  }
  now=millis();
  portENTER_CRITICAL(&dataMux);
  if (!lease.active(now)) lease={};
  if (accepted) mqAtScd=paired;
  climate=c; fan=safety.step(now,c.valid,c.at,c.ppm,lease);
  digitalWrite(FAN_PIN,fan.on?HIGH:LOW);
  portEXIT_CRITICAL(&dataMux);
}

/* VIGIL / ECE 3200 — Phase 3 local decision engine
   Classic ESP32 NodeMCU-32S. Original Ridge + MQ quadratic + Sharp baseline.
   Automatic CO2 ventilation after operator enables AUTO. No INA219. Research prototype, not a safety monitor.
   AP Vigil_IAQ / Vigil2026 ; GET /api/live ; serial 115200.
   Keep previously accepted MQ calibration in NVS (do not erase flash).
*/
#include <Arduino.h>
#include <Wire.h>
#include <SensirionI2cScd4x.h>
#include <WiFi.h>
#include <WebServer.h>
#include <Preferences.h>
#include <esp_adc_cal.h>
#include <math.h>
#include <string.h>
#include <stdlib.h>

constexpr int SDA_PIN=21,SCL_PIN=22,MQ_PIN=34,DUST_PIN=35,LED_PIN=27,FAN_PIN=25;
constexpr float MQ_VCC=5.0f, MQ_RL=1.0f, DIVIDER=2.0f;
// Enter actual rated fan power in watts if known; NAN = no energy claim.
constexpr float FAN_RATED_W=NAN;
constexpr uint32_t MQ_WARM_MS=600000UL, MQ_GAP_MS=20000UL;
constexpr uint32_t FAN_TEST_MS=10000UL;
// Prototype commissioning limits, not regulatory or health limits.
constexpr uint16_t CO2_ON=1000, CO2_OFF=750, PREVENTIVE_FLOOR=850;
constexpr uint32_t FAN_MIN_ON_MS=120000UL, RECOVERY_MS=180000UL;
constexpr uint32_t CONTROL_FRESH_MS=15000UL;
constexpr float FORECAST_MIN=10.0f, PREVENTIVE_RATE=5.0f;
constexpr uint8_t PREVENTIVE_VOTES=3;
constexpr uint32_t DUST_PERIOD_US=10000, DUST_SAMPLE_US=280, DUST_PULSE_US=320;
constexpr float DUST_BASE=1458.52f,DUST_SD=147.585f,DUST_LOW=1015.76f,DUST_ELEV=1901.28f,DUST_HIGH=2048.86f;
constexpr float OCC_BASE=511.0f;
constexpr float MQ_BETA[5]={-0.0978957479f,0.113921441f,0.0306626048f,0.0722774401f,-0.0166802f};
constexpr float MQ_MED=-0.0130058485f,MQ_SCALE=0.0478087528f,MQ_ALPHA=.2f,MQ_LIMIT=4.87158753f;
// Prior firmware's provisional screening bounds; final-model coverage unverified.
constexpr float T_MIN=20.5f,T_MAX=28.0f,RH_MIN=63.0f,RH_MAX=95.0f;
SensirionI2cScd4x scd40;
WebServer server(80);
Preferences prefs;
portMUX_TYPE dataMux=portMUX_INITIALIZER_UNLOCKED;
esp_adc_cal_characteristics_t dustCal;
uint32_t bootMs=0,lastPoll=0,lastReport=0,lastSCD=0;
bool scdInit=false,scdValid=false,apOK=false,adcTaskOK=false;
uint16_t co2=0;float temp=NAN,rh=NAN;

// Cross-task snapshots: only the ADC task touches analog inputs.
struct MQReading {uint32_t seq,at;float pinV,aoV,rs;bool valid;};
struct DustReading {uint32_t seq,at;float on,off,delta,filtered,z;uint16_t rejected,missed,minPulse,maxPulse,history;bool valid,ready,high;};
// Policy types must precede Arduino-generated function prototypes.
struct PolicyInput {
  uint32_t now, sampleAt;
  bool fresh, trendReady;
  uint16_t ppm;
  float mean, rate;
};
struct PolicyState {
  bool on=false, recovery=false, haveSample=false;
  uint32_t onAt=0, recoveryAt=0, lastSample=0;
  uint8_t forecastVotes=0;
  float forecast=NAN;
  const char* reason="WAITING_FOR_CO2";
};
void applyPolicy(PolicyState &s, const PolicyInput &in);
PolicyInput livePolicyInput(uint32_t now);

void filterDust(DustReading &d);
MQReading mqShared={0,0,NAN,NAN,NAN,false},mq={0,0,NAN,NAN,NAN,false};
DustReading dustShared={0,0,NAN,NAN,NAN,NAN,NAN,0,0,0,0,0,false,false,false},dust=dustShared;

// CO2 history + exact trained Ridge model (Phase 2.2).
uint32_t occTimes[24];float occValues[24];uint8_t occN=0;
float occMean=NAN,occDelta=NAN,occSlope=NAN,occEstimate=NAN;int occEven=-1;
bool occReady=false,occOut=false;
void clearOcc(){occN=0;occMean=occDelta=occSlope=occEstimate=NAN;occEven=-1;occReady=occOut=false;}
void popOcc(){if(!occN)return;for(int i=1;i<occN;i++){occTimes[i-1]=occTimes[i];occValues[i-1]=occValues[i];}--occN;}
void updateOcc(uint32_t now,float c){
  if(occN && now-occTimes[occN-1]>30000UL)clearOcc();
  if(occN==24)popOcc();occTimes[occN]=now;occValues[occN++]=c;
  while(occN>1 && now-occTimes[0]>60000UL)popOcc();
  float sum=0,ts=0;for(int i=0;i<occN;i++){sum+=occValues[i];ts+=(occTimes[i]-occTimes[0])/1000.0f;}
  occMean=sum/occN;occDelta=occMean-OCC_BASE;
  occReady=occOut=false;occSlope=occEstimate=NAN;occEven=-1;
  if(occN<4 || now-occTimes[0]<50000UL)return;
  float mt=ts/occN;double a=0,b=0;
  for(int i=0;i<occN;i++){float dt=(occTimes[i]-occTimes[0])/1000.0f-mt;a+=dt*(occValues[i]-occMean);b+=dt*dt;}
  if(b<=0)return;occSlope=60.0*a/b;
  occOut=occDelta<-11.61538462f||occDelta>391.1f||occSlope<-138.7419172f||occSlope>28.51248862f;
  float raw=3.176339566f+3.276897848f*(occDelta/100.0f)+0.8872977638f*(occSlope/10.0f);
  occEstimate=fminf(16.0f,fmaxf(0.0f,raw));occEven=2*(int)roundf(occEstimate/2.0f);occReady=true;
}

// MQ135 persistent local reference. Original namespace and hash algorithm.
float r0=NAN,x0=NAN,t0=NAN,h0=NAN;bool baselineOK=false;
float mqX=NAN,mqY=NAN,mqResidual=NAN,mqZ=NAN,mqEWMA=0;
bool votes[5]={};uint8_t voteN=0,votePos=0,votePositive=0;
bool mqAlert=false;uint32_t lastMQInference=0,lastMQUsedSeq=0;
const char* mqStatus="WARMING_UP";
uint32_t hashFloat(uint32_t h,float v){uint32_t b;memcpy(&b,&v,4);return (h^b)*16777619UL;}
uint32_t modelHash(){uint32_t h=2166136261UL;for(int i=0;i<5;i++)h=hashFloat(h,MQ_BETA[i]);h=hashFloat(h,MQ_MED);h=hashFloat(h,MQ_SCALE);h=hashFloat(h,MQ_ALPHA);return hashFloat(h,MQ_LIMIT);}
bool inCoverage(float t,float h){return isfinite(t)&&isfinite(h)&&t>=T_MIN&&t<=T_MAX&&h>=RH_MIN&&h<=RH_MAX;}
void loadMQReference(){
  if(!prefs.begin("vigil_ml",true)){Serial.println("[MQ] NVS not available");return;}
  bool valid=prefs.getBool("valid",false);uint32_t sig=prefs.getUInt("model_sig",0);
  r0=prefs.getFloat("r0",NAN);x0=prefs.getFloat("x0",NAN);t0=prefs.getFloat("t0",NAN);h0=prefs.getFloat("h0",NAN);
  prefs.end();
  baselineOK=valid&&sig==modelHash()&&isfinite(r0)&&r0>0&&isfinite(x0)&&inCoverage(t0,h0);
  Serial.printf("[MQ] saved=%08lx expected=%08lx reference=%s\n",(unsigned long)sig,(unsigned long)modelHash(),baselineOK?"ACCEPTED":"NOT ACCEPTED");
  if(baselineOK)Serial.printf("[MQ] R0=%.5f kOhm x0=%.7f T0=%.2f RH0=%.2f\n",r0,x0,t0,h0);
  else r0=x0=t0=h0=NAN; // no invented baseline and no flash writes
}
void resetMQDetector(){mqX=mqY=mqResidual=mqZ=NAN;mqEWMA=0;voteN=votePos=votePositive=0;memset(votes,0,sizeof(votes));mqAlert=false;lastMQInference=0;}
float polynomial(float t,float h){t=(t-25.0f)/5.0f;h=(h-75.0f)/10.0f;return MQ_BETA[0]*t+MQ_BETA[1]*h+MQ_BETA[2]*t*t+MQ_BETA[3]*h*h+MQ_BETA[4]*t*h;}
void updateMQModel(uint32_t now){
  // One inference per fresh SCD40 measurement, never per repeated HTTP poll.
  if(now-bootMs<MQ_WARM_MS){mqStatus="WARMING_UP";resetMQDetector();return;}
  if(!baselineOK){mqStatus="BASELINE_REQUIRED";resetMQDetector();return;}
  if(!mq.valid||now-mq.at>1500UL||mq.seq==lastMQUsedSeq){mqStatus="ADC_INVALID_OR_STALE";resetMQDetector();return;}
  lastMQUsedSeq=mq.seq;
  if(!inCoverage(temp,rh)){mqStatus="OUTSIDE_PROVISIONAL_COVERAGE";resetMQDetector();return;}
  if(lastMQInference&&now-lastMQInference>MQ_GAP_MS)resetMQDetector();
  mqX=logf(r0/mq.rs)-x0;mqY=polynomial(temp,rh)-polynomial(t0,h0);mqResidual=mqX-mqY;mqZ=(mqResidual-MQ_MED)/MQ_SCALE;
  if(!isfinite(mqZ)){mqStatus="INVALID_SCORE";resetMQDetector();return;}
  mqEWMA=MQ_ALPHA*fmaxf(0,mqZ)+(1-MQ_ALPHA)*mqEWMA;
  votes[votePos]=mqEWMA>MQ_LIMIT;votePos=(votePos+1)%5;if(voteN<5)voteN++;
  votePositive=0;for(int i=0;i<voteN;i++)if(votes[i])votePositive++;
  mqAlert=voteN==5&&votePositive>=3;lastMQInference=now;
  mqStatus=voteN<5?"VOTE_WARMUP":mqAlert?"UNUSUAL_RESPONSE":"NO_CONFIRMED_RESPONSE";
}

// Sharp median filter. Input is calibrated reconstructed ON mV, NOT delta.
float dustHist[30];uint8_t dustN=0,dustPos=0;uint32_t highSince=0,lastDustGood=0;bool highTracking=false;
int compareFloat(const void* a,const void* b){float x=*(const float*)a,y=*(const float*)b;return (x>y)-(x<y);}
float median30(){float v[30];memcpy(v,dustHist,dustN*sizeof(float));qsort(v,dustN,sizeof(float),compareFloat);return dustN%2?v[dustN/2]:(v[dustN/2-1]+v[dustN/2])*.5f;}
void resetDust(){dustN=dustPos=0;highTracking=false;highSince=0;lastDustGood=0;}
void filterDust(DustReading &d){
  d.filtered=d.z=NAN;d.ready=d.high=false;d.history=0;
  if(!d.valid){resetDust();return;}
  if(lastDustGood&&d.at-lastDustGood>2000UL)resetDust();lastDustGood=d.at;
  dustHist[dustPos]=d.on;dustPos=(dustPos+1)%30;if(dustN<30)dustN++;
  d.history=dustN;d.filtered=median30();d.z=(d.filtered-DUST_BASE)/DUST_SD;
  d.ready=dustN==30;if(!d.ready)return;
  if(d.filtered>=DUST_HIGH){if(!highTracking){highTracking=true;highSince=d.at;}d.high=d.at-highSince>=10000UL;}
  else {highTracking=false;highSince=0;}
}

// ADC acquisition task: fixed-time LED pulses, one MQ pair between pulses.
// Raw Sharp conversion is converted to calibrated mV AFTER LED is off.
// No serial/WiFi/I2C call is made in the timed pulse.
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
      filterDust(d);portENTER_CRITICAL(&dataMux);dustShared=d;portEXIT_CRITICAL(&dataMux);
      count=bad=missed=good=offGood=maxP=0;minP=65535;onSum=offSum=0;
    }
    // Same original two-range MQ method, spread across dust periods.
    if((int32_t)(next-micros())>3000){
      mqRawSum+=analogRead(MQ_PIN);mqMvSum+=analogReadMilliVolts(MQ_PIN);mqN++;
      if(mqN==20){
        float raw=mqRawSum/20.0f;
        if(!mqHighRange&&raw>=3900){mqHighRange=true;analogSetPinAttenuation(MQ_PIN,ADC_11db);(void)analogRead(MQ_PIN);}
        else {
          MQReading m={};m.seq=++mqSeq;m.at=millis();m.pinV=mqMvSum/20000.0f;m.aoV=m.pinV*DIVIDER;
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
void readSnapshots(){portENTER_CRITICAL(&dataMux);mq=mqShared;dust=dustShared;portEXIT_CRITICAL(&dataMux);}

// Phase 3: pure policy state machine, independent of GPIO and network.
// All time differences are unsigned, safe across millis() rollover.
void applyPolicy(PolicyState &s, const PolicyInput &in){
  if(!in.fresh){s=PolicyState();s.reason="CO2_UNAVAILABLE_AUTO_SUSPENDED";return;}
  bool newSample=!s.haveSample||in.sampleAt!=s.lastSample;
  if(newSample){
    if(s.haveSample && in.sampleAt-s.lastSample>CONTROL_FRESH_MS){s.forecastVotes=0;s.recovery=false;}
    s.haveSample=true;s.lastSample=in.sampleAt;
    // Local linear screening forecast; deliberately separate from occupancy Ridge.
    s.forecast=in.trendReady?fmaxf(0.0f,in.mean+FORECAST_MIN*in.rate):NAN;
    bool preventive=in.trendReady&&in.ppm>=PREVENTIVE_FLOOR&&in.rate>=PREVENTIVE_RATE&&s.forecast>=CO2_ON;
    if(preventive){if(s.forecastVotes<PREVENTIVE_VOTES)s.forecastVotes++;}else s.forecastVotes=0;
    if(in.ppm<CO2_OFF){if(!s.recovery){s.recovery=true;s.recoveryAt=in.sampleAt;}}
    else s.recovery=false;
  }
  if(!s.on){
    if(in.ppm>=CO2_ON){s.on=true;s.onAt=in.now;s.recovery=false;s.reason="CO2_THRESHOLD_EXCEEDED";}
    else if(s.forecastVotes>=PREVENTIVE_VOTES){s.on=true;s.onAt=in.now;s.recovery=false;s.reason="PREDICTED_CO2_THRESHOLD";}
    else s.reason=s.forecastVotes?"PREVENTIVE_CONFIRMING":in.ppm>=CO2_OFF?"CO2_MONITORING":"CO2_BELOW_RELEASE";
    return;
  }
  // A new high reading cancels recovery; intermediate band holds the fan ON.
  if(in.ppm>=CO2_OFF)s.recovery=false;
  if(in.now-s.onAt<FAN_MIN_ON_MS){s.reason="MINIMUM_RUNTIME";return;}
  if(s.recovery && s.lastSample-s.recoveryAt>=RECOVERY_MS){
    s.on=false;s.recovery=false;s.forecastVotes=0;s.reason="SUSTAINED_CO2_RECOVERY";return;
  }
  if(s.recovery)s.reason="RECOVERY_CONFIRMING";
  else s.reason=in.ppm>=CO2_ON?"CO2_THRESHOLD_EXCEEDED":"HYSTERESIS_HOLD";
}

// Manual commissioning mode at boot; 'a' enables automatic policy.
// '0' latches OFF, '1' supervised 10-second test then returns to OFF.
// No remote actuator endpoint is exposed on this development AP.
enum class FanMode : uint8_t { STANDBY, AUTO, MANUAL_TEST };
FanMode fanMode=FanMode::STANDBY;
PolicyState policy;
bool fanOn=false;uint32_t fanStarted=0;uint64_t fanAccum=0;
const char* fanReason="STANDBY_OPERATOR_ENABLE_REQUIRED";
const char* lastFanEvent="BOOT_OFF";
void setFan(bool on){uint32_t now=millis();if(on==fanOn)return;if(fanOn)fanAccum+=(uint32_t)(now-fanStarted);fanOn=on;if(on)fanStarted=now;digitalWrite(FAN_PIN,on?HIGH:LOW);}
uint64_t fanMs(){return fanAccum+(fanOn?(uint32_t)(millis()-fanStarted):0);}
const char* fanModeText(){return fanMode==FanMode::AUTO?"AUTO":fanMode==FanMode::MANUAL_TEST?"MANUAL_TEST":"STANDBY";}
PolicyInput livePolicyInput(uint32_t now){
  return {now,lastSCD,scdValid&&now-lastSCD<=CONTROL_FRESH_MS,
          occReady&&isfinite(occMean)&&isfinite(occSlope),co2,occMean,occSlope};
}
void fanTask(){
  if(fanMode==FanMode::AUTO){applyPolicy(policy,livePolicyInput(millis()));if(policy.on!=fanOn)lastFanEvent=policy.reason;setFan(policy.on);fanReason=policy.reason;}
  else if(fanMode==FanMode::MANUAL_TEST && millis()-fanStarted>=FAN_TEST_MS){setFan(false);fanMode=FanMode::STANDBY;fanReason="MANUAL_TEST_COMPLETE";lastFanEvent=fanReason;}
}
// Deterministic dry-run tests use only a local policy object, never setFan().
// Also run by host C++ harness. Returns number of failed assertions.
int policySelfTest(bool report){
  int fails=0;
  auto check=[&](bool ok,const char* label){if(!ok)fails++;if(report)Serial.printf("[TEST] %s %s\n",ok?"PASS":"FAIL",label);};
  PolicyState s;
  auto step=[&](uint32_t t,uint16_t c,bool fresh=true,bool trend=false,float mean=0,float rate=0){applyPolicy(s,{t,t,fresh,trend,c,mean,rate});};
  step(1000,700);check(!s.on,"normal stays off");
  step(6000,1000);check(s.on,"1000 ppm starts fan");
  step(11000,900);check(s.on,"hysteresis holds on");check(strcmp(s.reason,"MINIMUM_RUNTIME")==0,"minimum runtime active");
  for(uint32_t t=16000;t<=126000;t+=5000)step(t,700);
  check(s.on,"recovery not yet 180 seconds");
  for(uint32_t t=131000;t<=196000;t+=5000)step(t,700);
  check(!s.on,"continuous recovery releases fan");
  s=PolicyState();step(1000,900,true,true,890,12);step(6000,900,true,true,895,12);
  check(!s.on,"preventive needs three fresh readings");
  applyPolicy(s,{6100,6000,true,true,900,895,12});check(!s.on&&s.forecastVotes==2,"repeated poll does not add votes");
  step(11000,900,true,true,900,12);check(s.on,"preventive start");
  step(16000,900,false);check(!s.on,"stale CO2 suspends automatic fan");
  s=PolicyState();step(1000,1050);step(6000,700);step(11000,800);check(!s.recovery&&s.on,"recovery interrupted by rebound");
  s=PolicyState();step(1000,850,true,true,850,20);step(21000,850,true,true,850,20);check(s.forecastVotes==1,"measurement gap resets forecast votes");
  if(report)Serial.printf("[TEST] SUMMARY failed=%d (no physical fan action)\n",fails);
  return fails;
}
void serialCommands(){while(Serial.available()){
  int c=Serial.read();
  if(c=='0'){setFan(false);policy=PolicyState();fanMode=FanMode::STANDBY;fanReason="OPERATOR_OFF";lastFanEvent=fanReason;Serial.println("[FAN] STANDBY");}
  else if(c=='1'){setFan(false);policy=PolicyState();fanMode=FanMode::MANUAL_TEST;setFan(true);fanReason="SUPERVISED_MANUAL_TEST";lastFanEvent=fanReason;Serial.println("[FAN] TEST ON 10s");}
  else if(c=='a'||c=='A'){if(fanMode!=FanMode::AUTO){setFan(false);policy=PolicyState();fanMode=FanMode::AUTO;fanReason="AUTO_ENABLED";lastFanEvent=fanReason;Serial.println("[FAN] AUTO ENABLED");}}
  else if(c=='t'||c=='T'){policySelfTest(true);}
}}

void scdTask(uint32_t now){
  if(scdValid&&now-lastSCD>30000UL){scdValid=false;clearOcc();resetMQDetector();mqStatus="SCD_STALE";}
  if(!scdInit||now-lastPoll<1000UL)return;lastPoll=now;
  bool ready=false;if(scd40.getDataReadyStatus(ready)||!ready)return;
  uint16_t c=0;float t=NAN,h=NAN;
  if(scd40.readMeasurement(c,t,h)||!c||!isfinite(t)||!isfinite(h)||h<0||h>100)return;
  co2=c;temp=t;rh=h;scdValid=true;lastSCD=millis();updateOcc(lastSCD,c);readSnapshots();updateMQModel(millis());
}
const char* dustStatus(){if(!dust.seq||millis()-dust.at>2500UL||!dust.valid)return "INVALID_OR_STALE";if(!dust.ready)return "FILTER_WARMUP";if(dust.high)return "HIGH_PERSISTENT";if(dust.filtered>=DUST_HIGH)return "HIGH_PENDING";if(dust.filtered>=DUST_ELEV)return "ELEVATED";if(dust.filtered<DUST_LOW)return "LOW_RESPONSE";return "BASELINE_RANGE";}
const char* occStatus(){return !occReady?"WARMUP_OR_STALE":occOut?"OUT_OF_DOMAIN":"PROTOTYPE_IN_RANGE";}
const char* currentMQStatus(){if(!scdValid)return "SCD_UNAVAILABLE";if(!mq.seq||!mq.valid||millis()-mq.at>1500UL)return "ADC_INVALID_OR_STALE";if(lastMQInference&&millis()-lastMQInference>MQ_GAP_MS)return "STALE_INFERENCE";return mqStatus;}
// Multi-label fusion: warnings are not mutually exclusive. A single summary
// is for display only; it is not a certified IAQ index or safety determination.
bool controlFresh(uint32_t now){return scdValid&&now-lastSCD<=CONTROL_FRESH_MS;}
bool gasFresh(uint32_t now){return controlFresh(now)&&mq.valid&&mq.seq&&now-mq.at<=1500UL&&lastMQInference&&now-lastMQInference<=MQ_GAP_MS&&voteN==5;}
bool dustModelFresh(uint32_t now){return dust.valid&&dust.seq&&now-dust.at<=2500UL&&dust.ready;}
const char* roomCondition(uint32_t now){
  if(!controlFresh(now))return "CO2_UNAVAILABLE";
  if(co2>=CO2_ON)return "CO2_VENTILATION_DEMAND";
  if(gasFresh(now)&&mqAlert)return "GAS_RESPONSE_WARNING";
  if(dustModelFresh(now)&&dust.high)return "DUST_RESPONSE_WARNING";
  if(fanMode==FanMode::AUTO&&policy.forecastVotes>=PREVENTIVE_VOTES)return "PREDICTED_CO2_DEMAND";
  if(!gasFresh(now)||!dustModelFresh(now))return "PARTIAL_SENSOR_COVERAGE";
  if(dust.filtered<DUST_LOW)return "DUST_LOW_RESPONSE";
  if(dust.filtered>=DUST_ELEV)return "DUST_ELEVATED";
  if(co2>=CO2_OFF)return "CO2_MONITORING";
  return "NO_CONFIRMED_ANOMALY";
}
String number(float v,int decimals){return isfinite(v)?String(v,decimals):String("null");}
void addNum(String &j,const char* key,float v,int dec=3);
void addNum(String &j,const char* key,float v,int dec){j+=",\"";j+=key;j+="\":";j+=number(v,dec);}
void addText(String &j,const char* key,const char* val){j+=",\"";j+=key;j+="\":\"";j+=val;j+='"';}
void addBool(String &j,const char* key,bool v){j+=",\"";j+=key;j+="\":";j+=v?"true":"false";}
String telemetry(){
  readSnapshots();uint32_t now=millis();bool dustFresh=dust.seq&&now-dust.at<=2500UL&&dust.valid;
  bool mqFresh=mq.seq&&now-mq.at<=1500UL&&mq.valid;
  bool modelFresh=scdValid&&mqFresh&&lastMQInference&&now-lastMQInference<=MQ_GAP_MS;
  String j="{\"uptime_ms\":";j+=String(now);j.reserve(2600);
  addBool(j,"scd_valid",scdValid);addNum(j,"co2_ppm",scdValid?co2:NAN,0);addNum(j,"temperature_c",scdValid?temp:NAN);addNum(j,"rh_pct",scdValid?rh:NAN);
  addNum(j,"scd_age_ms",scdValid?now-lastSCD:NAN,0);
  addNum(j,"occupancy_baseline_ppm",OCC_BASE,0);addNum(j,"occupancy_mean_ppm",occMean);addNum(j,"occupancy_delta_ppm",occDelta);addNum(j,"co2_slope_ppm_min",occSlope);addNum(j,"occupancy_estimate",occReady?occEstimate:NAN);addNum(j,"occupancy_even",occReady?occEven:NAN,0);addText(j,"occupancy_status",occStatus());
  addBool(j,"mq_adc_valid",mqFresh);addBool(j,"mq_baseline_valid",baselineOK);addNum(j,"mq_gpio_v",mqFresh?mq.pinV:NAN);addNum(j,"mq_ao_v",mqFresh?mq.aoV:NAN);addNum(j,"mq_rs_kohm",mqFresh?mq.rs:NAN);addNum(j,"mq_r0_kohm",r0);addNum(j,"mq_residual",modelFresh?mqResidual:NAN);addNum(j,"mq_z",modelFresh?mqZ:NAN);addNum(j,"mq_ewma",modelFresh?mqEWMA:NAN);addNum(j,"mq_votes",modelFresh?votePositive:NAN,0);addBool(j,"mq_anomaly",modelFresh&&mqAlert);addText(j,"mq_status",currentMQStatus());addBool(j,"mq_high_rh_caution",scdValid&&rh>=88);
  addBool(j,"dust_valid",dustFresh);addNum(j,"dust_on_mv",dustFresh?dust.on:NAN);addNum(j,"dust_off_mv",dustFresh?dust.off:NAN);addNum(j,"dust_delta_mv",dustFresh?dust.delta:NAN);addNum(j,"dust_filtered_mv",dustFresh?dust.filtered:NAN);addNum(j,"dust_z",dustFresh?dust.z:NAN);addNum(j,"dust_history",dust.history,0);addNum(j,"dust_rejected",dust.rejected,0);addNum(j,"dust_missed",dust.missed,0);addNum(j,"dust_pulse_min_us",dust.minPulse,0);addNum(j,"dust_pulse_max_us",dust.maxPulse,0);addBool(j,"dust_high_confirmed",dustFresh&&dust.high);addText(j,"dust_status",dustStatus());
  bool controlOK=controlFresh(now),gasOK=gasFresh(now),dustOK=dustModelFresh(now);
  addText(j,"room_condition",roomCondition(now));addBool(j,"control_co2_fresh",controlOK);addBool(j,"gas_model_ready",gasOK);addBool(j,"dust_model_ready",dustOK);
  addBool(j,"gas_warning",gasOK&&mqAlert);addBool(j,"dust_warning",dustOK&&dust.high);addBool(j,"co2_demand",controlOK&&co2>=CO2_ON);
  addBool(j,"occupancy_context_valid",controlOK&&occReady&&!occOut);
  addNum(j,"co2_forecast_10min_ppm",controlOK&&occReady?fmaxf(0.0f,occMean+FORECAST_MIN*occSlope):NAN,1);
  addNum(j,"preventive_votes",policy.forecastVotes,0);addNum(j,"fan_recovery_s",policy.on&&policy.recovery?(policy.lastSample-policy.recoveryAt)/1000.0f:0,1);
  addNum(j,"fan_min_on_remaining_s",fanMode==FanMode::AUTO&&fanOn&&now-fanStarted<FAN_MIN_ON_MS?(FAN_MIN_ON_MS-(now-fanStarted))/1000.0f:0,1);
  addBool(j,"outside_air_quality_known",false);addBool(j,"ventilation_conflict_warning",fanOn&&((gasOK&&mqAlert)||(dustOK&&dust.high)));
  addBool(j,"fan_on",fanOn);addText(j,"fan_mode",fanModeText());addText(j,"fan_reason",fanReason);addText(j,"fan_last_event",lastFanEvent);addNum(j,"fan_runtime_s",fanMs()/1000.0,2);addNum(j,"fan_estimated_wh",isfinite(FAN_RATED_W)?FAN_RATED_W*fanMs()/3600000.0:NAN,5);j+='}';return j;
}
void setup(){
  pinMode(FAN_PIN,OUTPUT);digitalWrite(FAN_PIN,LOW);pinMode(LED_PIN,OUTPUT);digitalWrite(LED_PIN,LOW);
  Serial.begin(115200);delay(500);bootMs=millis();
  Serial.println("VIGIL PHASE 3 | a=AUTO, 0=OFF, 1=fan 10s, t=policy tests");
  pinMode(MQ_PIN,INPUT);pinMode(DUST_PIN,INPUT);analogReadResolution(12);analogSetPinAttenuation(DUST_PIN,ADC_11db);analogSetPinAttenuation(MQ_PIN,ADC_0db);
  (void)analogRead(DUST_PIN); // initialize ADC before timed task
  esp_adc_cal_characterize(ADC_UNIT_1,ADC_ATTEN_DB_11,ADC_WIDTH_BIT_12,1100,&dustCal);
  loadMQReference();Wire.begin(SDA_PIN,SCL_PIN);Wire.setClock(100000);scd40.begin(Wire,0x62);scd40.stopPeriodicMeasurement();delay(500);scdInit=scd40.startPeriodicMeasurement()==0;
  Serial.printf("[SCD40] %s\n",scdInit?"STARTED":"START FAILED");
  WiFi.mode(WIFI_AP);apOK=WiFi.softAP("Vigil_IAQ","Vigil2026");
  if(apOK){server.on("/",HTTP_GET,[](){server.send(200,"text/plain","VIGIL Phase 3. Live JSON: /api/live . AUTO enable and manual commands via USB serial only.");});server.on("/api/live",HTTP_GET,[](){server.sendHeader("Cache-Control","no-store");server.send(200,"application/json",telemetry());});server.begin();Serial.print("[WiFi] http://");Serial.println(WiFi.softAPIP());}
  else Serial.println("[WiFi] AP FAILED");
  adcTaskOK=xTaskCreatePinnedToCore(adcWorker,"VigilADC",4096,nullptr,2,nullptr,1)==pdPASS;
  Serial.printf("[ADC] %s\n",adcTaskOK?"TASK STARTED":"TASK FAILED");
}
void loop(){
  serialCommands();fanTask();readSnapshots();scdTask(millis());fanTask();
  if(apOK)server.handleClient();fanTask();
  uint32_t now=millis();if(now-lastReport>=1000UL){lastReport=now;Serial.println(telemetry());}
  delay(1);
}

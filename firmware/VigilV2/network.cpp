#include "device.h"
#include <ArduinoJson.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <time.h>

// Optional operator-supplied public HTTPS URL and trust root, never device secrets.
#if __has_include("site_config.h")
#include "site_config.h"
#else
static const char* INGEST_URL="";
static const char* ROOT_CA="";
#endif

struct Settings {char ssid[33], password[65], secret[129];};
static Settings settings{};
static char bootId[33];
static WebServer portal(80);
static DNSServer dns;
static bool serving=false, credentialsChanged=false;
static const unsigned batchSize=5;
static Record batch[batchSize];

static bool transfer(char* dest,size_t capacity,const String& value) {
  if (value.length()>=capacity) return false;
  for(unsigned i=0;i<value.length();++i)
    if ((unsigned char)value[i]<32 || (unsigned char)value[i]==127) return false;
  memcpy(dest,value.c_str(),value.length()+1);
  return true;
}

static void portalForm() {
  portal.sendHeader("Cache-Control","no-store");
  portal.send(200,"text/html","<form method='post' action='/save'>Wi-Fi SSID <input name='ssid' required>"
    " Wi-Fi password <input type='password' name='password'> Device secret <input type='password' name='secret' required>"
    "<button>Save</button></form>");
}

static void configurePortal() {
  portal.on("/",HTTP_GET,portalForm);
  portal.onNotFound(portalForm);
  portal.on("/save",HTTP_POST,[](){
    Settings next{};
    if (!transfer(next.ssid,sizeof(next.ssid),portal.arg("ssid")) || !next.ssid[0] ||
        !transfer(next.password,sizeof(next.password),portal.arg("password")) ||
        !transfer(next.secret,sizeof(next.secret),portal.arg("secret")) || !next.secret[0]) {
      portal.send(400,"text/plain","Invalid settings"); return;
    }
    Preferences prefs;
    bool saved=prefs.begin("vigil-net",false) && prefs.putBytes("config",&next,sizeof(next))==sizeof(next);
    prefs.end();
    if (!saved) { portal.send(500,"text/plain","Save failed"); return; }
    settings=next;
    portal.send(200,"text/plain","Saved. Reconnecting.");
    credentialsChanged=true;
  });
}

static void randomHex(char* dest,size_t bytes) {
  uint8_t raw[16];
  esp_fill_random(raw,bytes);
  for(size_t i=0;i<bytes;++i) snprintf(dest+2*i,3,"%02x",raw[i]);
}

static void startPortal() {
  char password[25];
  randomHex(password,12);
  WiFi.mode(WIFI_AP_STA);
  if (!WiFi.softAP("VIGIL-Setup",password)) return;
  Serial.printf("Temporary setup AP VIGIL-Setup password %s\n",password);
  dns.start(53,"*",WiFi.softAPIP());
  portal.begin();
  serving=true;
}

static void stopPortal() {
  if (!serving) return;
  dns.stop(); portal.stop(); WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  serving=false;
}

static void number(JsonObject obj,const char* key,float value) {
  if (isfinite(value)) obj[key]=value;
  else obj[key]=nullptr;
}

static void encode(JsonObject o,const Record& r) {
  const auto& d=r.dust;
  const auto& m=r.mq;
  const auto& c=r.scd;
  o["seq"]=r.seq; o["uptime_ms"]=r.at;
  JsonObject dust=o["sharp"].to<JsonObject>();
  dust["seq"]=d.seq; dust["at_ms"]=d.at; dust["valid"]=d.valid;
  number(dust,"on_mv",d.on); number(dust,"off_mv",d.off); number(dust,"delta_mv",d.delta);
  dust["max_pulse_us"]=d.maxPulse; dust["min_pulse_us"]=d.minPulse;
  dust["rejected"]=d.rejected; dust["missed"]=d.missed;
  JsonObject mq=o["mq135"].to<JsonObject>();
  mq["seq"]=m.seq; mq["at_ms"]=m.at; mq["valid"]=m.seq && m.valid;
  mq["fresh"]=m.seq && m.valid && r.at-m.at<=1500;
  number(mq,"adc_raw",m.seq?m.raw:NAN); number(mq,"gpio_v",m.seq?m.pinV:NAN);
  number(mq,"ao_v",m.seq?m.aoV:NAN); number(mq,"rs_kohm",m.seq?m.rs:NAN);
  JsonObject scd=o["scd40"].to<JsonObject>();
  scd["at_ms"]=c.at; scd["valid"]=c.valid && r.at-c.at<=30000; scd["control_fresh"]=c.valid && r.at-c.at<=15000;
  scd["error"]=c.error;
  number(scd,"co2_ppm",c.valid?c.ppm:NAN); number(scd,"temperature_c",c.valid?c.t:NAN);
  number(scd,"rh_pct",c.valid?c.h:NAN);
  o["fan_on"]=r.fan.on; o["fan_reason"]=r.fan.reason;
  o["local_override"]=strcmp(r.fan.reason,"backend") && strcmp(r.fan.reason,"no_command");
}

static bool upload() {
  portENTER_CRITICAL(&dataMux);
  unsigned count=backlog.copy(batch,batchSize);
  uint32_t drops=backlog.dropped;
  portEXIT_CRITICAL(&dataMux);
  if (!count) return true;
  if (strncmp(INGEST_URL,"https://",8) || !ROOT_CA[0] || !settings.secret[0]) return false;

  JsonDocument payload;
  payload["boot_id"]=bootId; payload["dropped_total"]=drops;
  JsonArray records=payload["records"].to<JsonArray>();
  for(unsigned i=0;i<count;++i) encode(records.add<JsonObject>(),batch[i]);
  String body;
  if (payload.overflowed() || !serializeJson(payload,body) || body.length()!=measureJson(payload)) return false;
  WiFiClientSecure tls;
  tls.setCACert(ROOT_CA);
  HTTPClient http;
  http.setConnectTimeout(5000); http.setTimeout(5000); http.useHTTP10(true);
  if (!http.begin(tls,INGEST_URL)) return false;
  http.addHeader("Content-Type","application/json");
  http.addHeader("X-Device-Secret",settings.secret);
  uint32_t sent=millis();
  int status=http.POST(body);
  if (status!=200) return false;
  int length=http.getSize();
  if (length<=0 || length>512) return false;
  char response[513];
  if (http.getStream().readBytes(response,length)!=(size_t)length) return false;
  response[length]=0;
  JsonDocument reply;
  if (deserializeJson(reply,response) || !reply["boot_id"].is<const char*>() ||
      strcmp(reply["boot_id"],bootId) || !reply["ack_seq"].is<uint64_t>()) return false;
  uint64_t ack=reply["ack_seq"].as<uint64_t>();
  if (ack!=batch[count-1].seq) return false;

  Lease next{};
  bool usable=reply["fan_seconds"].is<uint32_t>() &&
      decodeLease(reply["mode"].as<const char*>(),reply["fan_cmd"].as<const char*>(),
                  reply["fan_seconds"].as<uint32_t>(),sent,next);
  portENTER_CRITICAL(&dataMux);
  // A replay response may acknowledge storage but must never actuate the fan.
  bool live=backlog.size && backlog.slots[(backlog.head+backlog.size-1)%120].seq==ack;
  backlog.ack(ack);
  portEXIT_CRITICAL(&dataMux);
  if (live && millis()-batch[count-1].at<=15000 && usable && next.active(millis())) setLease(next);
  else setLease({});
  return true;
}

void networkWorker(void*) {
  WiFi.persistent(false); WiFi.mode(WIFI_STA);
  randomHex(bootId,16);
  Preferences prefs;
  if (prefs.begin("vigil-net",true)) {
    if (prefs.getBytesLength("config")==sizeof(settings)) prefs.getBytes("config",&settings,sizeof(settings));
    prefs.end();
  }
  settings.ssid[sizeof(settings.ssid)-1]=settings.password[sizeof(settings.password)-1]=settings.secret[sizeof(settings.secret)-1]=0;
  configurePortal();
  uint32_t attempt=millis(),lastUpload=attempt;
  if (settings.ssid[0]) WiFi.begin(settings.ssid,settings.password);
  bool wasOnline=false;
  for (;;) {
    uint32_t now=millis();
    if (credentialsChanged) {
      stopPortal(); WiFi.disconnect(); WiFi.begin(settings.ssid,settings.password);
      attempt=now; credentialsChanged=false; wasOnline=false;
    }
    if (WiFi.status()==WL_CONNECTED) {
      stopPortal();
      if (!wasOnline) configTime(0,0,"pool.ntp.org","time.google.com");
      wasOnline=true;
      if (now-lastUpload>=5000 && time(nullptr)>0) {
        // Drain backlogs faster than acquisition. Failures retry at normal cadence.
        bool ok=upload();
        portENTER_CRITICAL(&dataMux); bool behind=backlog.size>=batchSize; portEXIT_CRITICAL(&dataMux);
        lastUpload=millis()-(ok && behind?5000:0);
      }
    } else {
      if (wasOnline) { attempt=now; wasOnline=false; setLease({}); }
      if (!serving && (!settings.ssid[0] || now-attempt>=30000)) startPortal();
      if (settings.ssid[0] && now-attempt>=30000) { WiFi.reconnect(); attempt=now; }
      if (serving) { dns.processNextRequest(); portal.handleClient(); }
    }
    delay(10);
  }
}

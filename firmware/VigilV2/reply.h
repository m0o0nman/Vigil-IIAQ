#pragma once
#include <ArduinoJson.h>
#include "control.h"

// ACK validity and command validity are independent: malformed commands cannot
// hold up durable telemetry ingestion or grant a lease.
inline bool parseReply(const char* response,int length,const char* bootId,
                       uint64_t expected,uint32_t sent,Lease& next,bool& usable) {
  next={}; usable=false;
  if (length<=0 || length>512) return false;
  // ArduinoJson stops after the closing brace. Reject appended content too.
  struct Reader {
    const char* p; int remaining;
    int read() { if (!remaining) return -1; --remaining; return (unsigned char)*p++; }
    size_t readBytes(char* out,size_t n) {
      size_t count=n<(size_t)remaining?n:(size_t)remaining;
      memcpy(out,p,count); p+=count; remaining-=count; return count;
    }
  } reader{response,length};
  JsonDocument reply;
  if (memchr(response,0,length) || memchr(response,'\\',length) || deserializeJson(reply,reader) || !reply["boot_id"].is<const char*>() ||
      strcmp(reply["boot_id"],bootId) || !reply["ack_seq"].is<uint64_t>()) return false;
  while (reader.remaining) { int c=reader.read(); if (c!=' ' && c!='\t' && c!='\r' && c!='\n') return false; }
  // The flat response uses ASCII tokens and integers. Round-trip its lexical
  // form to reject permissive-parser extensions and duplicate keys.
  char canonical[513];
  size_t n=serializeJson(reply,canonical,sizeof(canonical));
  size_t at=0;
  bool inString=false;
  for (int i=0;i<length;++i) {
    char c=response[i];
    if (!inString && (c==' ' || c=='\t' || c=='\r' || c=='\n')) continue;
    if (at==n || canonical[at++]!=c) return false;
    if (c=='"') inString=!inString;
  }
  if (at!=n) return false;
  uint64_t ack=reply["ack_seq"].as<uint64_t>();
  if (ack!=expected) return false;

  usable=reply["fan_seconds"].is<uint32_t>() &&
      decodeLease(reply["mode"].as<const char*>(),reply["fan_cmd"].as<const char*>(),
                  reply["fan_seconds"].as<uint32_t>(),sent,next);
  return true;
}

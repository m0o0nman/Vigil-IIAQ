#pragma once
#include <stdint.h>
#include <string.h>

// inputs/code/VIGIL_Phase3_Fixed.ino:25-27,204-230,245-251
struct FanDecision { bool on; const char* reason; };
struct Lease {
  bool on = false;
  uint32_t start = 0, duration = 0;
  bool active(uint32_t now) const { return duration && now-start < duration; }
};

inline bool decodeLease(const char* mode, const char* cmd, uint32_t seconds,
                        uint32_t sent, Lease& result) {
  result = {};
  if (!mode || !cmd || (strcmp(mode,"auto") && strcmp(mode,"off") && strcmp(mode,"freshen"))) return false;
  bool on = !strcmp(cmd,"on");
  if ((!on && strcmp(cmd,"off")) || (!strcmp(mode,"off") && on) ||
      (!strcmp(mode,"freshen") && !on) || seconds > UINT32_MAX/1000 || (on && !seconds)) return false;
  result.on=on; result.start=sent; result.duration=seconds*1000;
  return true;
}

struct Safety {
  bool latched=false, recovering=false, seen=false;
  uint32_t started=0, recovery=0, last=0;
  FanDecision step(uint32_t now, bool valid, uint32_t sample, uint16_t ppm, const Lease& lease) {
    if (!valid || now-sample>15000) {
      *this=Safety();
      return {false,"stale_co2"};
    }
    if (!seen || sample!=last) {
      if (seen && sample-last>15000) recovering=false;
      seen=true; last=sample;
      if (ppm>=1000 && !latched) { latched=true; started=now; }
      if (latched && ppm<750) {
        if (!recovering) { recovering=true; recovery=sample; }
      } else recovering=false;
    }
    if (latched) {
      if (now-started<120000) return {true,"minimum_runtime"};
      if (!recovering || last-recovery<180000) return {true,recovering?"recovery":"co2_hold"};
      latched=false; recovering=false;
    }
    return {lease.active(now) && lease.on, lease.active(now)?"backend":"no_command"};
  }
};

// One producer, one consumer. Caller serializes copy/ack/append operations.
template<class T, unsigned N> struct Ring {
  T slots[N];
  unsigned head=0, size=0;
  uint32_t dropped=0;
  void append(const T& item) {
    if (size==N) { head=(head+1)%N; --size; ++dropped; }
    slots[(head+size)%N]=item; ++size;
  }
  unsigned copy(T* dest,unsigned capacity) const {
    unsigned count=size<capacity?size:capacity;
    for(unsigned i=0;i<count;++i) dest[i]=slots[(head+i)%N];
    return count;
  }
  void ack(uint64_t seq) {
    while(size && slots[head].seq<=seq) { head=(head+1)%N; --size; }
  }
};

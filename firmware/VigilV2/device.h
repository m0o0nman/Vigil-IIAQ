#pragma once
#include <Arduino.h>
#include "control.h"

struct MQReading {uint32_t seq,at;float pinV,aoV,rs,raw;bool valid;};
struct DustReading {uint32_t seq,at;float on,off,delta;uint16_t rejected,missed,minPulse,maxPulse;bool valid;};
struct Climate {uint32_t at;uint16_t ppm;float t,h;bool valid;const char* error;};
struct Record {uint64_t seq;uint32_t at;DustReading dust;MQReading mq;Climate scd;MQReading mqAtScd;FanDecision fan;};
extern portMUX_TYPE dataMux;
extern Ring<Record,120> backlog;
bool beginSensors();
void serviceSensors();
void setLease(Lease next);
void networkWorker(void*);

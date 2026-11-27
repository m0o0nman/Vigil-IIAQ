#include "../VigilV2/reply.h"
#include <cassert>
#include <cstdio>
#include <string>

int main() {
  const std::string prefix=R"({"boot_id":"boot","ack_seq":7,)";
  const std::string fields=R"("mode":"auto","fan_cmd":"on","fan_seconds":10})";
  Lease lease; bool usable;
  auto parse=[&](const std::string& body) {
    return parseReply(body.data(),body.size(),"boot",7,100,lease,usable);
  };
  assert(parse(prefix+fields) && usable && lease.active(100) && !lease.active(10100));
  assert(!parse(prefix+fields+"junk") && !usable);
  assert(!parse(prefix+fields.substr(0,fields.size()-1)));
  assert(!parse(R"({"boot_id":"x","ack_seq":7})"));
  assert(!parse(R"({"boot_id":"boot","ack_seq":6})"));
  assert(!parse(R"({"boot_id":"boot","ack_seq":"7"})"));
  assert(parse(R"({"boot_id":"boot","ack_seq":7})") && !usable);
  for (auto invalid:{"-1","true","1.5","null","\"10\""}) {
    assert(parse(prefix+R"("mode":"auto","fan_cmd":"on","fan_seconds":)"+invalid+"}") && !usable);
  }
  assert(parse(prefix+R"("mode":"off","fan_cmd":"off","fan_seconds":0})") && usable && !lease.on);
  puts("PASS ArduinoJson reply decoding, boot/ACK binding, types and malformed commands");
}

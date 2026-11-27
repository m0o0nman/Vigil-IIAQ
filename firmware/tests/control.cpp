#include "../VigilV2/control.h"
#include <cassert>
#include <cstdio>

int main() {
  Lease on;
  assert(decodeLease("auto","on",10,0,on));
  Safety s;
  assert(!s.step(0,false,0,0,on).on);
  assert(s.step(0,true,0,600,on).on);
  assert(!s.step(10000,true,0,600,on).on);
  assert(!decodeLease("off","on",10,0,on));
  assert(!decodeLease("freshen","off",10,0,on));
  assert(!decodeLease(nullptr,"on",10,0,on));
  assert(!decodeLease("auto","on",UINT32_MAX,0,on));
  assert(!decodeLease("auto","on",0,0,on));
  assert(!decodeLease("auto","bad",10,0,on));
  assert(decodeLease("off","off",0,0,on));
  assert(s.step(100,true,100,1000,on).on);
  assert(s.step(15100,true,100,1000,on).on);
  assert(!s.step(15101,true,100,1000,on).on);
  assert(!s.step(16000,true,16000,850,on).on);
  assert(s.step(20000,true,20000,1000,on).on);
  for(unsigned t=25000;t<=145000;t+=5000) assert(s.step(t,true,t,700,on).on);
  assert(s.step(150000,true,150000,750,on).on); // rebound cancels recovery
  for(unsigned t=155000;t<335000;t+=5000) assert(s.step(t,true,t,749,on).on);
  assert(!s.step(335000,true,335000,749,on).on);
  assert(decodeLease("freshen","on",10,UINT32_MAX-5000,on));
  assert(on.active(4998) && !on.active(4999));
  puts("PASS command validation, lease expiry and uptime wrap");
  puts("PASS high, stale, minimum runtime, rebound and sustained recovery");

  struct Item { uint64_t seq; unsigned at; bool valid; };
  Ring<Item,3> q{};
  Item batch[2]{};
  for(unsigned i=1;i<=3;++i) q.append({i,i*1000,i!=2});
  assert(q.copy(batch,2)==2 && batch[0].seq==1 && !batch[1].valid);
  assert(q.copy(batch,2)==2 && batch[1].at==2000); // failed upload; replay
  q.append({4,4000,true}); // overflow during in-flight upload
  assert(q.dropped==1);
  q.ack(2);
  assert(q.copy(batch,2)==2 && batch[0].seq==3 && batch[1].seq==4);
  q.ack(2); assert(q.size==2); // duplicate ACK
  q.ack(4); assert(!q.size);
  puts("PASS bounded FIFO, retry, in-flight overflow and duplicate ACK");
}

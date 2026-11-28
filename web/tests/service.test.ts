import {beforeEach,describe,expect,it} from 'vitest'
import {Memory,batch} from './fixtures'
import {ingest,ownerChange} from '../src/service'
import {approved} from '../src/models'
import {parseBatch,type Batch} from '../src/protocol'
import {ingestRoute,ownerRoute} from '../src/http'
import {calibrationRow,columns} from '../src/calibration'

const req=(data:unknown,headers:Record<string,string>={})=>new Request('https://local/api',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)})
let db:Memory
beforeEach(()=>{db=new Memory();process.env.VIGIL_OWNER_UID='fixture-owner';process.env.VIGIL_DEVICE_SECRET='synthetic-test-only'})
describe('route authorization and validation',()=>{
  it('authenticates device independently of owner and bounds body size',async()=>{
    expect((await ingestRoute(req(batch()),db)).status).toBe(401)
    const headers={'x-device-secret':'synthetic-test-only'}
    const ok=await ingestRoute(req(batch(),headers),db);expect(ok.status).toBe(200)
    expect(Number(ok.headers.get('content-length'))).toBe((await ok.text()).length)
    expect((await ingestRoute(req({},headers),db)).status).toBe(400)
    expect((await ingestRoute(req('x'.repeat(40000),headers),db)).status).toBe(413)
  })
  it('rejects anonymous, invalid and nonowner tokens; accepts verified owner',async()=>{
    const headers={authorization:'Bearer token','idempotency-key':'case-1'}
    for(const [r,auth,status] of [
      [req({}),async()=>'fixture-owner',401],
      [req({},headers),async()=>{throw Error()},401],
      [req({},headers),async()=>'other',403],
      [req({mode:'off'},headers),async()=>'fixture-owner',200]
    ] as const)expect((await ownerRoute(r,'command',db,auth)).status).toBe(status)
  })
  it('rejects malformed clocks, flags, fields, boot ids and unordered batches',()=>{
    for(const mutate of [(b:Batch)=>b.boot_id='bad',(b:Batch)=>b.records[0].sharp.valid=false,
      (b:Batch)=>b.records[0].mq135.fresh=false,(b:Batch)=>b.records[0].sharp.at_ms+=1,
      (b:Batch)=>b.records.push(b.records[0]),(b:Batch)=>b.records[0].scd40.rh_pct=101]){
      const b=batch();mutate(b);expect(()=>parseBatch(b)).toThrow()
    }
  })
})
describe('durability and sequencing (mock storage)',()=>{
  it('atomic duplicates across concurrent workers and cold restart',async()=>{
    const b=batch();await Promise.all([ingest(db,b,1000),ingest(db,b,1000)])
    expect(db.view!.revision).toBe(1)
    const other=new Memory();other.docs=structuredClone(db.docs)
    await ingest(other,batch(2),2000)
    expect(other.view!.latest!.dust.history).toBe(2)
    const collision=batch();collision.records[0].fan_on=true
    await expect(ingest(other,collision,3000)).rejects.toThrow('conflicting')
  })
  it('preserves capture order and marks proven overflow gaps',async()=>{
    await ingest(db,batch(),1000)
    await expect(ingest(db,batch(3),3000)).rejects.toThrow('Preceding')
    const b=batch(3);b.dropped_total=1;await ingest(db,b,3000)
    expect(db.view!.gaps).toBe(1);expect(db.view!.latest!.dust.history).toBe(1)
    await expect(ingest(db,batch(2),4000)).rejects.toThrow('missing')
  })
  it('recovers after either store fails without acknowledging a partial write',async()=>{
    db.failCommit=true;await expect(ingest(db,batch(),1000)).rejects.toThrow();expect(db.docs).toEqual({})
    db.failCommit=false;db.failMirror=true;await expect(ingest(db,batch(),1000)).rejects.toThrow()
    db.failMirror=false;const ack=await ingest(db,batch(),2000)
    expect(ack.ack_seq).toBe(1);expect(ack.fan_seconds).toBe(0);expect(db.view!.latest!.dust.history).toBe(1)
  })
  it('archives a minute once, keeps open rows durable and protects live from replay',async()=>{
    await ingest(db,batch(1,59000),59000)
    const b=batch(2,60000);b.command_eligible=false;await ingest(db,b,65000)
    expect(db.view!.latest!.sample.seq).toBe(1)
    expect(Object.keys(db.docs).filter(p=>p.includes('/minutes/'))).toEqual(['sessions/'+b.boot_id+'/minutes/0'])
    await ingest(db,batch(3,61000),66000);expect(db.view!.latest!.sample.seq).toBe(3)
  })
  it('starts a new boot separately and fences older boots',async()=>{
    const old=batch();await ingest(db,old,1000)
    for(const seq of [1,2]){
      const b=batch(seq);b.boot_id='b'.repeat(32);await ingest(db,b,20000+seq*1000)
    }
    expect(db.view!.boot).toBe('b'.repeat(32));expect(db.view!.latest!.dust.history).toBe(2)
    await ingest(db,batch(2),30000);expect(db.view!.boot).toBe('b'.repeat(32))
  })
  it('unfolds capture clock wrap and resets on an invalid Sharp aggregate',async()=>{
    await ingest(db,batch(1,0xfffffff0),1000)
    const b=batch(2,1000);Object.assign(b.records[0].sharp,{valid:false,fresh:false,rejected:100,on_mv:null})
    await ingest(db,parseBatch(b),2016)
    expect(db.view!.latest!.capture_ms).toBe(2**32+1000);expect(db.view!.latest!.dust.history).toBe(0)
  })
})
describe('owner state',()=>{
  it('limits freshen to its remaining lease, reports actual local overrides separately',async()=>{
    await ingest(db,batch(),1000);await ownerChange(db,'command',{mode:'freshen'},1000)
    const b=batch(2);Object.assign(b.records[0],{fan_on:false,local_override:true,fan_reason:'stale_co2'})
    const reply=await ingest(db,b,2000)
    expect(reply.fan_cmd).toBe('on');expect(reply.fan_seconds).toBeLessThanOrEqual(9)
    expect(db.view!.latest!.sample.local_override).toBe(true)
    expect((await ingest(db,batch(3,12000),12000)).fan_cmd).toBe('off')
  })
  it('rejects unapproved versions and reloads approved version across cold start',async()=>{
    await ingest(db,batch(),1000)
    await expect(ownerChange(db,'rollback',{model:'sharp',version:'candidate'})).rejects.toThrow('unavailable')
    db.docs['models/sharp/versions/copy']={approved:true,spec:approved.sharp}
    await ownerChange(db,'rollback',{model:'sharp',version:'copy'})
    await ingest(db,batch(2),2000);expect(db.view!.latest!.dust.history).toBe(1)
    expect(db.view!.latest!.versions).toContain('sharp=copy')
  })
  it('captures source-shaped calibration rows and aborts without model activation',async()=>{
    await ingest(db,batch(),1000)
    const start=await ownerChange(db,'start',{sensor:'sharp'},1500) as {session:string}
    await expect(ownerChange(db,'start',{sensor:'sharp'},1600)).rejects.toThrow('already open')
    await ingest(db,batch(2),2000)
    expect(Object.keys(calibrationRow('sharp',start.session,db.view!.latest!))).toEqual(columns.sharp.split(','))
    expect(Object.keys(db.docs).some(p=>p.startsWith('calibrations/'+start.session+'/minutes/'))).toBe(true)
    await ownerChange(db,'abort',{session:start.session},3000);expect(db.view!.calibration).toBeNull()
  })
})
it('does not renew a retried Freshen request after a mirror failure',async()=>{
  db.failMirror=true
  await expect(ownerChange(db,'command',{mode:'freshen'},1000,'same-key')).rejects.toThrow()
  db.failMirror=false
  const result=await ownerChange(db,'command',{mode:'freshen'},5010,'same-key')
  expect(result).toEqual({mode:'freshen',expires:11000})
  await expect(ownerChange(db,'command',{mode:'off'},5010,'same-key')).rejects.toThrow('already used')
})
it('requires distinct fresh SCD readings; stale or replay batches cannot drive fan',async()=>{
  const first=batch(1,5000);first.records[0].scd40.co2_ppm=1050;await ingest(db,first,5000)
  const next=batch(2,6000);next.records[0].scd40=first.records[0].scd40
  next.records[0].mq_at_scd=first.records[0].mq_at_scd
  expect((await ingest(db,parseBatch(next),6000)).fan_cmd).toBe('on')
  expect(db.view!.latest!.occupancy!.mean).toBe(1050)
  const stale=batch(3,21000);stale.records[0].scd40={...first.records[0].scd40,control_fresh:false}
  stale.records[0].mq_at_scd=first.records[0].mq_at_scd
  expect((await ingest(db,parseBatch(stale),21000)).fan_cmd).toBe('off')
  expect(db.view!.latest!.forecast).toBeNull()
  const delayed=batch(4,22000);delayed.records[0].scd40.co2_ppm=1100
  expect((await ingest(db,delayed,99000)).fan_cmd).toBe('off')
  expect(db.view!.latest!.sample.seq).toBe(3)
})
it('sizes an actual minute and five-minute view at nominal ESP32 cadence',async()=>{
  const bytes=(x:unknown)=>Buffer.byteLength(JSON.stringify(x))
  let peak=0,fullMinute=0,wire=0,readBytes=0
  // One aggregate per second, one new SCD reading per five, five records/upload.
  for(let block=0;block<254;block++){
    const start=block*5+1,b=batch(start)
    b.records=[]
    for(let seq=start;seq<start+5;seq++){
      const r=batch(seq).records[0]
      r.scd40.at_ms=start*1000;r.mq_at_scd.at_ms=start*1000;r.mq_at_scd.seq=start
      b.records.push(r)
    }
    if(block>=194)readBytes+=bytes(db.docs['system/projection'])
    wire=bytes(b);await ingest(db,parseBatch(b),(start+4)*1000)
    peak=Math.max(peak,bytes(db.docs['system/projection']))
  }
  const minutes=Object.entries(db.docs).filter(([k])=>k.includes('/minutes/'))
  expect(minutes).toHaveLength(21)
  for(const [,doc] of minutes)fullMinute=Math.max(fullMinute,bytes(doc))
  expect(Object.keys(db.view!.buffer)).toHaveLength(301)
  console.log('Synthetic JSON bytes', {batch:wire,minute:fullMinute,peakControl:peak,meanControlRead:Math.round(readBytes/60),projection:bytes(db.view)})
})

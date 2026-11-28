// All sensor traces here are synthetic; no room or sensor was exercised.
import {it,expect} from 'vitest'
import {Memory,batch} from './fixtures'
import {ingest,ownerChange} from '../src/service'
import {columns,type Sensor} from '../src/calibration'
import type {Run} from '../src/quality'
import {approved} from '../src/models'
import {ownerRoute} from '../src/http'
import {csvLine} from '../src/export'

const epoch=700000
const sample=(seq:number)=>{
  const b=batch(seq,epoch+seq*1000),s=b.records[0]
  const k=Math.floor((seq-1)/5)*5+1
  Object.assign(s.scd40,{at_ms:epoch+k*1000,co2_ppm:515,temperature_c:25,rh_pct:75})
  Object.assign(s.mq_at_scd,{seq:k,at_ms:epoch+k*1000,rs_kohm:5})
  s.sharp.on_mv=1480+12*Math.sin(seq/15)
  return b
}
async function setup(sensor:Sensor,confirmed=true){
  const db=new Memory()
  await ingest(db,sample(1),epoch+1000)
  const {session}=await ownerChange(db,'start',{sensor,conditions_confirmed:confirmed},epoch+1001) as {session:string}
  return {db,session}
}
function state(db:Memory,id:string){return (db.docs['calibrations/'+id] as {run:Run}).run}
async function feed(db:Memory,from:number,to:number,modify?:(b:ReturnType<typeof sample>)=>void){
  for(let i=from;i<=to;i+=5){
    const b=sample(i)
    b.records=Array.from({length:Math.min(5,to-i+1)},(_,j)=>sample(i+j).records[0])
    modify?.(b)
    await ingest(db,b,b.records.at(-1)!.uptime_ms)
  }
}
for(const sensor of ['occupancy','sharp','mq135'] as const){
  it('activates only the permitted '+sensor+' parameters and restores v0',async()=>{
    const {db,session}=await setup(sensor)
    await feed(db,2,126)
    const run=state(db,session)
    expect(run.stage,run.reason).toBe('passed')
    expect(db.docs['models/'+sensor]).toEqual({active:session})
    const path='models/'+sensor+'/versions/'+session
    const v=db.docs[path] as {spec:typeof approved[typeof sensor],calibration:{source:string}}
    expect(v.calibration.source).toBe('v0')
    const retained=Object.entries(db.docs).filter(([key])=>key.startsWith('calibrations/'+session)||key===path)
    console.log('Synthetic retained calibration bytes',sensor,Buffer.byteLength(JSON.stringify(Object.fromEntries(retained))))
    if(sensor==='occupancy')expect(v.spec).toEqual({...approved.occupancy,parameters:{...approved.occupancy.parameters,HISTORICAL_EMPTY_CO2_PPM:515}})
    if(sensor==='mq135'){
      expect(v.spec).toEqual(approved.mq135)
      expect(run.candidate).toMatchObject({r0:5,x0:0,t0:25,h0:75})
      expect(db.view!.latest?.gas?.status).not.toBe('BASELINE_REQUIRED')
    }
    if(sensor==='sharp'){
      expect(run.warnings.length).toBeGreaterThan(0)
      expect(run.candidate!.spread).toBeGreaterThan(0)
    }
    await ownerChange(db,'rollback',{model:sensor,version:'v0'},epoch+127000)
    await feed(db,127,127)
    expect(db.docs[path]).toEqual(v)
    expect(db.view!.latest!.dust.history).toBe(1)
    expect(db.view!.latest!.versions).toContain(sensor+'=v0')
  })
}
it('holds the previous pointer for unstable climate, CO2, Sharp or missing confirmation',async()=>{
  for(const cause of ['co2','climate','sharp','unconfirmed']){
    const {db,session}=await setup(cause==='sharp'?'sharp':cause==='climate'?'mq135':'occupancy',cause!=='unconfirmed')
    await feed(db,2,126,b=>{
      for(const r of b.records){
        if(cause==='co2')r.scd40.co2_ppm=r.seq<90?515:580
        if(cause==='climate')r.scd40.temperature_c=r.seq<90?25:27
        if(cause==='sharp')r.sharp.on_mv=2200
      }
    })
    expect(state(db,session).stage).toBe('failed')
    expect(db.docs['models/'+state(db,session).sensor]).toEqual({active:'v0'})
  }
})
it('rejects a sequence gap, invalid pulse, fan operation, reboot and missing telemetry',async()=>{
  for(const cause of ['gap','pulse','fan','boot','offline']){
    const {db,session}=await setup('sharp')
    if(cause==='offline')await ownerChange(db,'status',{},epoch+30000)
    else await feed(db,cause==='gap'?3:2,4,b=>{
      if(cause==='gap')b.dropped_total=1
      if(cause==='pulse')b.records[0].sharp.max_pulse_us=341
      if(cause==='fan')for(const r of b.records)Object.assign(r,{fan_on:true,local_override:true,fan_reason:'minimum_runtime'})
      if(cause==='boot'){b.boot_id='c'.repeat(32);b.dropped_total=1}
    })
    expect(state(db,session).stage).toBe('failed')
    expect(db.docs['models/sharp']).toEqual({active:'v0'})
    if(cause==='fan')expect(db.view!.latest!.sample).toMatchObject({fan_on:true,local_override:true})
  }
})
it('serializes competing starts, rejects unauthorized access and aborts idempotently',async()=>{
  const db=new Memory()
  process.env.VIGIL_OWNER_UID='synthetic-owner'
  expect((await ownerRoute(new Request('https://local/api/calibrate/start'),'start',db)).status).toBe(401)
  const results=await Promise.allSettled([1,2].map(i=>ownerChange(db,'start',{sensor:'sharp'},epoch,String(i))))
  expect(results.filter(v=>v.status==='fulfilled')).toHaveLength(1)
  const id=db.view!.calibration!
  await ownerChange(db,'abort',{session:id},epoch+1000,'abort')
  await ownerChange(db,'abort',{session:id},epoch+2000,'abort')
  expect(state(db,id).stage).toBe('aborted')
})
it('resumes across cold starts, ignores duplicates and activates atomically through both failure boundaries',async()=>{
  const {db,session}=await setup('occupancy')
  await feed(db,2,121)
  const cold=new Memory();cold.docs=structuredClone(db.docs)
  await ingest(cold,sample(121),epoch+121000)
  expect(state(cold,session)).toEqual(state(db,session))
  cold.failCommit=true
  await expect(feed(cold,122,122)).rejects.toThrow()
  expect(cold.docs['models/occupancy']).toEqual({active:'v0'})
  cold.failCommit=false;cold.failMirror=true
  await expect(feed(cold,122,122)).rejects.toThrow()
  expect(cold.docs['models/occupancy']).toEqual({active:session})
  cold.failMirror=false;await feed(cold,122,122)
  expect(state(cold,session).stage).toBe('passed')
  expect(cold.view!.calibration).toBeNull()
  const docs=Object.entries(cold.docs).filter(([k])=>k.startsWith('calibrations/'+session+'/minutes/'))
  const rows=docs.flatMap(([,d])=>Object.values((d as {rows:Record<string,{values:Record<string,unknown>}>}).rows))
  expect(rows.length).toBe(121)
  const header=columns.occupancy.split(',')
  for(const {values} of rows){
    expect(Object.keys(values)).toEqual(header)
    expect(values.pc_timestamp_local).toMatch(/Z$/)
    expect(csvLine(header.map(k=>values[k])).trimEnd().split(',')).toHaveLength(header.length)
    expect(values.ground_truth_people).toBeNull()
  }
})
it('rejects too few independent SCD samples even when every held sample is fresh',async()=>{
  const {db,session}=await setup('occupancy')
  await feed(db,2,126,b=>{
    for(const r of b.records){
      const seq=Math.floor((r.seq-1)/12)*12+1
      r.scd40.at_ms=epoch+seq*1000
      Object.assign(r.mq_at_scd,{seq,at_ms:r.scd40.at_ms})
    }
  })
  expect(state(db,session).gates.distinct_scd_samples.ok).toBe(false)
  expect(db.docs['models/occupancy']).toEqual({active:'v0'})
})
it('isolates historical status lookups from a new active session',async()=>{
  const {db,session}=await setup('sharp')
  await ownerChange(db,'abort',{session},epoch+1200)
  await ownerChange(db,'start',{sensor:'mq135'},epoch+1300)
  const result=await ownerChange(db,'status',{session},epoch+30000)
  expect(result).toMatchObject({session,status:'aborted'})
  expect(db.view!.calibration).not.toBeNull()
})

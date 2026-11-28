import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { co2Status, humidityStatus } from '../ui/bands'
import { observationTime, recentRows, statusOf, type Latest } from '../ui/state'
import { initial, process as infer } from '../src/engine'
import { parseBatch } from '../src/protocol'
import { exportRoute, ownerRoute } from '../src/http'

describe('provisional display thresholds',()=>{
  it.each([
    [599,'Fresh'],[600,'OK'],[749,'OK'],[750,'Stuffy'],[999,'Stuffy'],[1000,'Poor'],
  ])('classifies %s ppm as %s',(ppm,expected)=>expect(co2Status(ppm)?.label).toBe(expected))
  it.each([
    [29.9,'Dry'],[30,'Comfortable'],[59.9,'Comfortable'],[60,'Humid'],
  ])('classifies %s percent RH as %s',(rh,expected)=>expect(humidityStatus(rh)).toBe(expected))
  it('suppresses invalid labels',()=>{
    for(const value of [null,NaN,Infinity,-1]) {
      expect(co2Status(value)).toBeNull()
      expect(humidityStatus(value)).toBeNull()
    }
    expect(humidityStatus(100.1)).toBeNull()
  })
})

function syntheticLatest(): Latest {
  const batch=parseBatch(JSON.parse(readFileSync('../firmware/README.md','utf8').split('```json\n')[1].split('\n```')[0]))
  batch.dropped_total=5
  const sample=batch.records[0]
  return {...infer(initial(),sample,batch,'sharp=v0'),boot_id:batch.boot_id,received_at:20000,decision_reason:'monitoring'}
}
describe('live display gates with synthetic firmware data',()=>{
  it('distinguishes absence, disconnect and freshness expiry; preserves a last observation timestamp',()=>{
    const sample=syntheticLatest()
    expect(statusOf(null,20000,true).connection).toBe('Waiting for device')
    expect(statusOf(sample,20000,false)).toMatchObject({deviceLive:false,co2:null,co2Band:null,humidity:null})
    expect(statusOf(sample,20000,true)).toMatchObject({co2:610,humidity:'Humid',fumes:'Warming up',optical:'Warming up'})
    expect(statusOf(sample,35001,true)).toMatchObject({connection:'Device offline',co2:null,optical:'Unavailable'})
    expect(observationTime(sample)).toBe(19098)
  })
  it('ages optical observations independently and suppresses unavailable/invalid data',()=>{
    const sample=syntheticLatest()
    expect(statusOf(sample,22500,true).optical).toBe('Warming up')
    expect(statusOf(sample,22501,true).optical).toBe('Unavailable')
    sample.sample.scd40.valid=false
    sample.sample.scd40.control_fresh=false
    expect(statusOf(sample,20000,true)).toMatchObject({co2:null,temp:null,rh:null,humidity:null})
  })
})

it('requires owner authentication before reading the calibration archive',async()=>{
  process.env.VIGIL_OWNER_UID='synthetic-owner'
  const url='http://local/api/calibrate/status?view=history'
  expect((await ownerRoute(new Request(url),'status')).status).toBe(401)
  const other=new Request(url,{headers:{Authorization:'Bearer synthetic'}})
  expect((await ownerRoute(other,'status',undefined,async()=>'different')).status).toBe(403)
})

it('requires authentication before opening session analytics',async()=>{
  process.env.VIGIL_OWNER_UID='synthetic-owner'
  const boot='00112233445566778899aabbccddeeff'
  const url='http://local/api/export/'+boot+'?view=analytics'
  expect((await exportRoute(new Request(url),boot)).status).toBe(401)
})

describe('monitor history from the synthetic RTDB window',()=>{
  const latest=syntheticLatest()
  latest.sample.seq=8
  latest.capture_ms=20000
  const row=(t:number,ppm:number|null)=>({t,ppm,fan:false})
  it('waits for matching sequence and capture time across listener updates',()=>{
    expect(recentRows({7:row(19000,610)},latest)).toEqual([])
    expect(recentRows({8:row(2000,610)},latest)).toEqual([])
  })
  it('preserves sequence gaps, unavailable readings and the latest capture boundary',()=>{
    const buffer={4:row(15000,608),6:row(18000,609),7:row(19000,null),8:row(20000,610),9:row(21000,615)}
    expect(recentRows(buffer,latest)).toEqual([
      {t:15000,ppm:608},{t:16500,ppm:null},{t:18000,ppm:609},{t:19000,ppm:null},{t:20000,ppm:610},
    ])
  })
})

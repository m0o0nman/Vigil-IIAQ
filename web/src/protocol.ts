import type { Anchor } from './models'
export class Failure extends Error { constructor(public status:number,message:string){super(message)} }
export function check(ok:unknown,message='Invalid telemetry'):asserts ok {if(!ok)throw new Failure(400,message)}
export const elapsed=(now:number,then:number)=>(now-then)>>>0
type MQ={seq:number,at_ms:number,valid:boolean,fresh:boolean,adc_raw:number|null,gpio_v:number|null,ao_v:number|null,rs_kohm:number|null}
type Dust={seq:number,at_ms:number,valid:boolean,fresh:boolean,on_mv:number|null,off_mv:number|null,delta_mv:number|null,min_pulse_us:number,max_pulse_us:number,rejected:number,missed:number}
type SCD={at_ms:number,valid:boolean,control_fresh:boolean,error:string,co2_ppm:number|null,temperature_c:number|null,rh_pct:number|null}
export type Sample={seq:number,uptime_ms:number,sharp:Dust,mq135:MQ,mq_at_scd:MQ,scd40:SCD,fan_on:boolean,fan_reason:string,local_override:boolean}
export type Batch={boot_id:string,dropped_total:number,command_eligible:boolean,legacy_mq_reference:Anchor|null,records:Sample[]}
export function object(value:unknown,keys:string):asserts value is Record<string,unknown>{
  check(value!==null&&typeof value==='object'&&!Array.isArray(value))
  const expected=keys.split(' ')
  check(Object.keys(value).length===expected.length&&expected.every(k=>Object.hasOwn(value,k)))
}
const uint=(v:unknown,max=0xffffffff)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=max
const finite=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)
const clock=(reference:number,t:number)=>uint(t)&&elapsed(reference,t)<0x80000000
const numeric=(o:Record<string,unknown>,keys:string)=>keys.split(' ').every(k=>o[k]===null||finite(o[k]))
function mq(m:MQ,t:number){
  object(m,'seq at_ms valid fresh adc_raw gpio_v ao_v rs_kohm')
  check(uint(m.seq)&&uint(m.at_ms)&&(!m.seq||clock(t,m.at_ms))&&typeof m.valid==='boolean'&&numeric(m,'adc_raw gpio_v ao_v rs_kohm'))
  if(m.valid)check(m.seq&&m.adc_raw!==null&&m.adc_raw>2&&m.adc_raw<4090&&m.ao_v!==null&&m.ao_v>0&&m.ao_v<5&&m.gpio_v!==null&&m.rs_kohm!==null&&m.rs_kohm>0)
  check(m.fresh===(m.valid&&elapsed(t,m.at_ms)<=1500))
}
export function parseBatch(value:unknown):Batch {
  object(value,'boot_id dropped_total command_eligible legacy_mq_reference records')
  const b=value as unknown as Batch
  check(typeof b.boot_id==='string'&&/^[0-9a-f]{32}$/.test(b.boot_id)&&uint(b.dropped_total)&&typeof b.command_eligible==='boolean')
  if(b.legacy_mq_reference!==null){
    const a=b.legacy_mq_reference
    object(a,'model_sig r0 x0 t0 h0');check(uint(a.model_sig)&&numeric(a,'r0 x0 t0 h0'))
  }
  check(Array.isArray(b.records)&&b.records.length>=1&&b.records.length<=10)
  for(const [i,r] of b.records.entries()){
    object(r,'seq uptime_ms sharp mq135 mq_at_scd scd40 fan_on fan_reason local_override')
    check(uint(r.seq,Number.MAX_SAFE_INTEGER)&&r.seq>0&&uint(r.uptime_ms))
    if(i)check(r.seq===b.records[i-1].seq+1&&clock(r.uptime_ms,b.records[i-1].uptime_ms))
    const d=r.sharp,c=r.scd40
    object(d,'seq at_ms valid fresh on_mv off_mv delta_mv max_pulse_us min_pulse_us rejected missed')
    check(d.seq===(r.seq>>>0)&&clock(r.uptime_ms,d.at_ms)&&numeric(d,'on_mv off_mv delta_mv')&&typeof d.valid==='boolean')
    check(uint(d.rejected,100)&&uint(d.missed,65535)&&uint(d.min_pulse_us,65535)&&uint(d.max_pulse_us,65535))
    check(d.valid===(d.rejected<=5&&d.missed===0&&d.on_mv!==null&&d.on_mv>=1015.76*.5)&&d.fresh===(d.valid&&elapsed(r.uptime_ms,d.at_ms)<=2500))
    object(c,'at_ms valid control_fresh error co2_ppm temperature_c rh_pct')
    check(uint(c.at_ms)&&typeof c.valid==='boolean'&&numeric(c,'co2_ppm temperature_c rh_pct')&&['waiting','init_failed','ready_failed','invalid_measurement','ok'].includes(c.error))
    const age=elapsed(r.uptime_ms,c.at_ms)
    // Validity may expire between sampling and serialization at the 30s boundary.
    if(c.valid)check(age<=30000&&uint(c.co2_ppm,65535)&&c.co2_ppm!>0&&c.temperature_c!==null&&c.rh_pct!==null&&c.rh_pct>=0&&c.rh_pct<=100)
    check(c.control_fresh===(c.valid&&age<=15000))
    mq(r.mq135,r.uptime_ms);mq(r.mq_at_scd,c.at_ms)
    check(typeof r.fan_on==='boolean'&&['backend','no_command','stale_co2','minimum_runtime','recovery','co2_hold'].includes(r.fan_reason))
    check(r.local_override===!['backend','no_command'].includes(r.fan_reason))
  }
  return b
}

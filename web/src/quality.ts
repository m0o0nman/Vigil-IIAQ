import {approved, median, signature, type Anchor, type Specs} from './models'
import type {Sensor} from './calibration'
import type {Result} from './engine'
import {elapsed} from './protocol'

export type Stage = 'warmup'|'measuring'|'passed'|'failed'|'aborted'
export type Gates = Record<string, {ok:boolean, measured:number|string}>
export type Run = ReturnType<typeof newRun>
export function newRun(id:string,sensor:Sensor,started:number,boot:string|null,source:string,confirmed:boolean){
  return {
    id,sensor,started,boot,source,confirmed,stage:'warmup' as Stage,reason:'',
    first:null as number|null,windowStart:null as number|null,last:null as number|null,
    lastSeq:0,lastReceipt:started,lastScd:null as number|null,lastMq:null as number|null,
    lastPulse:null as number|null,firstScd:null as number|null,
    warnings:[] as string[],maxCaptureGap:0,maxScdAge:0,maxMqAge:0,maxPulse:0,observations:0,count:0,co2:[] as number[],temps:[] as number[],humidity:[] as number[],
    rs:[] as number[],raw:[] as number[],filtered:[] as number[],gates:{} as Gates,
    candidate:null as Record<string,number>|null,ended:null as number|null
  }
}
export function reject(run:Run,reason:string){
  run.stage='failed'
  run.reason=reason
  run.gates[reason]={ok:false,measured:reason}
}
const range=(values:number[])=>Math.max(...values)-Math.min(...values)
const within=(v:number,min:number,max:number)=>v>=min && v<=max
export function evaluate(run:Run,specs:Specs,oldAnchor:Anchor|null){
  const gate=(name:string,ok:boolean,measured:number|string)=>{run.gates[name]={ok,measured}}
  gate('uninterrupted_valid_collection',true,run.observations)
  gate('max_capture_gap_ms',run.maxCaptureGap<=2000,run.maxCaptureGap)
  gate('max_scd_age_ms',run.maxScdAge<=15000,run.maxScdAge)
  if(run.sensor==='sharp')gate('max_sharp_pulse_us',run.maxPulse<=340,run.maxPulse)
  if(run.sensor==='mq135')gate('max_paired_mq_age_ms',run.maxMqAge<=1500,run.maxMqAge)
  gate('room_conditions_confirmed',run.confirmed,run.confirmed?'owner confirmed':'no confirmation')
  gate('distinct_scd_samples',run.co2.length>=11,run.co2.length)
  gate('scd_span_ms',run.lastScd!==null && run.firstScd!==null && run.lastScd-run.firstScd>=50000,
    (run.lastScd??0)-(run.firstScd??0))
  if(run.co2.length){
    gate('co2_range_ppm',range(run.co2)<=36,range(run.co2))
    gate('temperature_range_C',range(run.temps)<=1.66,range(run.temps))
    gate('humidity_range_pct',range(run.humidity)<=9.08,range(run.humidity))
    if(run.sensor==='occupancy'){
      const baseline=median(run.co2)
      const shift=Math.abs(baseline-specs.occupancy.parameters.HISTORICAL_EMPTY_CO2_PPM)
      gate('previous_baseline_shift_ppm',shift<=36,shift)
      run.comparison.baseline_delta_ppm=baseline-specs.occupancy.parameters.HISTORICAL_EMPTY_CO2_PPM
      run.candidate={baseline}
    }
  }
  if(run.sensor==='mq135' && run.rs.length){
    gate('mq_temperature_range_C',range(run.temps)<=0.96,range(run.temps))
    gate('mq_humidity_range_pct',range(run.humidity)<=1.91,range(run.humidity))
    const r0=median(run.rs),x0=median(run.rs.map(rs=>Math.log(r0/rs)))
    const ratio=Math.max(...run.rs)/Math.min(...run.rs)
    gate('resistance_ratio',ratio<=7.1539/6.4582,ratio)
    gate('reference_scale_kohm',within(r0,1.93455,9.7021),r0)
    if(oldAnchor?.r0 && oldAnchor.r0>0 && oldAnchor.x0!==null && oldAnchor.t0!==null && oldAnchor.h0!==null && oldAnchor.model_sig===signature() && within(oldAnchor.t0,20.5,28) && within(oldAnchor.h0,63,95)){
      const change=Math.max(r0/oldAnchor.r0,oldAnchor.r0/r0)
      gate('previous_reference_ratio',change<=9.7021/1.93455,change)
      run.comparison={r0_delta:r0-oldAnchor.r0,x0_delta:x0-oldAnchor.x0,t0_delta:median(run.temps)-oldAnchor.t0,rh0_delta:median(run.humidity)-oldAnchor.h0}
    }else run.warnings.push('No accepted prior MQ anchor for comparison')
    run.candidate={r0,x0,t0:median(run.temps),h0:median(run.humidity),model_sig:signature()}
  }
  if(run.sensor==='sharp' && run.filtered.length){
    const baseline=median(run.filtered)
    const spread=1.4826*median(run.filtered.map(v=>Math.abs(v-baseline)))
    gate('filtered_count',run.filtered.length>=30,run.filtered.length)
    gate('baseline4_stable_window_envelope',within(baseline,1346.51,1640.45),baseline)
    gate('baseline4_window_spread',within(spread,1.40847-1e-10,90.749946+1e-10),spread)
    const shift=Math.abs(baseline-specs.sharp.baseline_mv)
    gate('previous_baseline_shift_mv',shift<=1640.45-1346.51,shift)
    run.comparison={baseline_delta_mv:baseline-specs.sharp.baseline_mv,spread_delta_mv:spread-specs.sharp.robust_sd_mv}
    if(Math.abs(baseline/1458.52-1)>0.01 || Math.abs(spread/147.585-1)>0.01)
      run.warnings.push('Differs from the provisional firmware reference by more than 1%')
    if(Math.abs(baseline/1492.15-1)>0.01 || Math.abs(spread/198.460836-1)>0.01)
      run.warnings.push('Differs from full Baseline 4 rolling statistics by more than 1%')
    run.candidate={baseline,spread,previous_baseline:specs.sharp.baseline_mv,previous_spread:specs.sharp.robust_sd_mv,
      firmware_difference_mv:baseline-approved.sharp.baseline_mv,baseline4_difference_mv:baseline-1492.15}
  }
  const failed=Object.entries(run.gates).filter(([,g])=>!g.ok).map(([k])=>k)
  if(failed.length || !run.candidate)reject(run,'Quality checks failed: '+failed.join(', '))
  else run.stage='passed'
}

export function observe(run:Run,row:Result,specs:Specs,anchor:Anchor|null){
  const {sample:s,capture_ms:t}=row
  const c=s.scd40,m=s.mq_at_scd,d=s.sharp
  if(row.gap || (run.lastSeq && s.seq!==run.lastSeq+1))return reject(run,'Missing observation sequence')
  if(run.last!==null && (t<=run.last || t-run.last>2000))return reject(run,'Capture continuity lost')
  if(run.last!==null)run.maxCaptureGap=Math.max(run.maxCaptureGap,t-run.last)
  run.first??=t
  run.last=t;run.lastSeq=s.seq;run.observations++
  if(s.fan_on)return reject(run,'Fan operated during collection')
  if(run.sensor==='sharp'){
    const pulse=t-elapsed(s.uptime_ms,d.at_ms)
    if(!d.valid || !d.fresh || d.on_mv===null || d.missed || d.min_pulse_us<300 || d.max_pulse_us>340 ||
       (run.lastPulse!==null && (pulse<=run.lastPulse || pulse-run.lastPulse>2000)))
      return reject(run,'Invalid or discontinuous Sharp pulses')
    run.maxPulse=Math.max(run.maxPulse,d.max_pulse_us)
    run.lastPulse=pulse
    run.raw.push(d.on_mv)
    if(run.raw.length>30)run.raw.shift()
  }
  if(run.stage==='warmup'){
    if(run.sensor==='mq135' && s.uptime_ms<600000)return
    if(run.sensor==='sharp'?run.raw.length<30:t-run.first<60000)return
    run.stage='measuring';run.windowStart=t
  }
  if(!c.control_fresh || !c.valid || c.co2_ppm===null || c.temperature_c===null || c.rh_pct===null)
    return reject(run,'Fresh CO2 and climate required')
  run.maxScdAge=Math.max(run.maxScdAge,elapsed(s.uptime_ms,c.at_ms))
  const scd=t-elapsed(s.uptime_ms,c.at_ms)
  if(scd>=run.windowStart! && scd!==run.lastScd){
    if(run.lastScd!==null && (scd<=run.lastScd || scd-run.lastScd>15000))return reject(run,'Missing fresh SCD measurements')
    if(run.sensor==='mq135'){
      if(!m.valid||!m.fresh||!m.rs_kohm||m.seq===run.lastMq)return reject(run,'Fresh paired MQ sample required')
      if(!within(c.temperature_c,20.5,28)||!within(c.rh_pct,63,95))return reject(run,'Climate outside MQ coverage')
      run.maxMqAge=Math.max(run.maxMqAge,elapsed(c.at_ms,m.at_ms))
      run.lastMq=m.seq;run.rs.push(m.rs_kohm)
    }
    run.firstScd??=scd;run.lastScd=scd
    run.co2.push(c.co2_ppm);run.temps.push(c.temperature_c);run.humidity.push(c.rh_pct)
  }
  run.count++
  if(run.sensor==='sharp')run.filtered.push(median(run.raw))
  if(t-run.windowStart!>=60000)evaluate(run,specs,anchor)
}

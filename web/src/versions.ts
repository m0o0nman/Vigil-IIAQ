import {isDeepStrictEqual} from 'node:util'
import {approved,type Specs,type Anchor,signature} from './models'
import type {Run} from './quality'
export type Version={approved:boolean,spec:Specs[keyof Specs],calibration?:ReturnType<typeof buildMetadata>}
function buildMetadata(run:Run,now:number){
  return {version:run.id,session:run.id,model:run.sensor,source:run.source,
    device:'single provisioned ESP32',boot:run.boot,first_ms:run.first,window_ms:run.windowStart,last_ms:run.last,
    parameters:run.candidate!,comparison:run.comparison,warnings:run.warnings,gates:run.gates,observations:run.observations,window_count:run.count,
    distinct_scd:run.co2.length,created:now,room_confirmed:run.confirmed,
    provenance:'Device capture; PROVISIONAL gates derived from immutable CSVs. See docs/phase4_calibration.md.',
    limitation:{occupancy:'Occupancy remains approximate after environmental baseline recalibration.',
      mq135:'Owner-approved reconstructed anchor fitter; historical fitter unknown.',
      sharp:'Relative ON response only; Baseline 4 selection remains uncertain.'}[run.sensor]}
}
function materialize(sensor:keyof Specs,p:Record<string,number>){
  if(sensor==='occupancy')return {...approved.occupancy,parameters:{...approved.occupancy.parameters,HISTORICAL_EMPTY_CO2_PPM:p.baseline}}
  if(sensor==='sharp')return {...approved.sharp,baseline_mv:p.baseline,robust_sd_mv:p.spread,
    low_mv:p.baseline-3*p.spread,elevated_mv:p.baseline+3*p.spread,high_mv:p.baseline+4*p.spread}
  return approved[sensor]
}
export function versionFor(run:Run,now:number):Version{
  return {approved:true,spec:materialize(run.sensor,run.candidate!),calibration:buildMetadata(run,now)}
}
export function allowed(name:keyof Specs,v:Version|undefined|null,id:string){
  if(!v?.approved)return false
  const c=v.calibration
  if(!c)return isDeepStrictEqual(v.spec,approved[name])
  return c.model===name && c.version===id && c.session===id && c.room_confirmed &&
    Object.values(c.parameters).every(Number.isFinite) && Object.values(c.gates).every(g=>g.ok) &&
    isDeepStrictEqual(v.spec,materialize(name,c.parameters))
}
export function savedAnchor(v?:Version|null):Anchor|null{
  const p=v?.calibration?.parameters
  return p?{r0:p.r0,x0:p.x0,t0:p.t0,h0:p.h0,model_sig:signature()}:null
}

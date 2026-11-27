import type {Result} from './engine'
import type {Sample} from './protocol'
const fields={
  sharp:['seq','at_ms','valid','fresh','on_mv','off_mv','delta_mv','min_pulse_us','max_pulse_us','rejected','missed'],
  scd40:['at_ms','valid','control_fresh','error','co2_ppm','temperature_c','rh_pct'],
  mq135:['seq','at_ms','valid','fresh','adc_raw','gpio_v','ao_v','rs_kohm'],
  mq_at_scd:['seq','at_ms','valid','fresh','adc_raw','gpio_v','ao_v','rs_kohm']
} as const
const core=['seq','uptime_ms','fan_on','fan_reason','local_override'] as const
export const telemetryColumns=[...core,...Object.entries(fields).flatMap(([group,keys])=>keys.map(k=>group+'_'+k)),
  'capture_ms','gap','versions','occupancy_estimate','gas_ready','mq_ewma','sharp_status','forecast_persistence','forecast_linear','forecast_robust']
export function telemetryCells(result:Result){
  const s:Sample=result.sample
  const sensors=Object.entries(fields).flatMap(([group,keys])=>{
    const sensor:Record<string,unknown>=s[group as keyof typeof fields]
    return keys.map(k=>sensor[k])
  })
  return [...core.map(k=>s[k]),...sensors,result.capture_ms,result.gap,result.versions,result.occupancy?.estimate,
    result.gas_ready,result.gas?.ewma,result.dust.status,result.forecast?.persistence,result.forecast?.linear,result.forecast?.robust]
}
export function csvLine(cells:unknown[]){
  return cells.map(v=>{
    const s=v==null?'':String(v)
    return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s
  }).join(',')+'\n'
}

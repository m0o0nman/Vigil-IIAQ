import type {Result} from './engine'
// Input CSV headers are preserved verbatim. Missing logger fields stay null.
export const columns={
  mq135:'PC_Time,Uptime_s,CO2_ppm,Temp_C,RH_pct,ADC_raw,GPIO34_V,AO_V,Rs_kOhm,Rs_R0,R0check_kOhm',
  sharp:'timestamp_iso,elapsed_s,time_ms,samples,on_raw_mean,on_raw_min,on_raw_max,off_raw_mean,off_raw_min,off_raw_max,on_adc_mv,off_adc_mv,on_sensor_mv,off_sensor_mv,delta_sensor_mv,max_pulse_us,rail_samples',
  occupancy:'pc_timestamp_local,session_id,device_sequence,device_uptime_ms,phase,stage_id,ground_truth_people,training_eligible,stage_elapsed_s,room_length_ft,room_width_ft,room_height_ft,room_volume_m3,scd40_co2_ppm,scd40_temp_c,scd40_rh_pct,mq135_adc_raw,mq135_gpio34_v,mq135_ao_v,mq135_rs_kohm,mq135_valid,empty_baseline_co2_ppm,co2_delta_from_baseline_ppm,co2_rate_ppm_per_hour'
}
export type Sensor=keyof typeof columns
export function calibrationRow(sensor:Sensor,id:string,result:Result,offset?:number,started?:number){
  const {sample:s}=result,m=s.mq_at_scd,c=s.scd40,d=s.sharp
  const row:Record<string,string|number|boolean|null>=Object.fromEntries(columns[sensor].split(',').map(k=>[k,null]))
  if(sensor==='sharp')Object.assign(row,{time_ms:d.at_ms,samples:100,on_sensor_mv:d.on_mv,
    off_sensor_mv:d.off_mv,delta_sensor_mv:d.delta_mv,max_pulse_us:d.max_pulse_us})
  if(sensor==='mq135')Object.assign(row,{Uptime_s:s.uptime_ms/1000,CO2_ppm:c.co2_ppm,Temp_C:c.temperature_c,
    RH_pct:c.rh_pct,ADC_raw:s.mq135.adc_raw,GPIO34_V:s.mq135.gpio_v,AO_V:s.mq135.ao_v,Rs_kOhm:s.mq135.rs_kohm})
  if(sensor==='occupancy')Object.assign(row,{session_id:id,device_sequence:s.seq,device_uptime_ms:s.uptime_ms,
    training_eligible:0,scd40_co2_ppm:c.co2_ppm,scd40_temp_c:c.temperature_c,scd40_rh_pct:c.rh_pct,
    mq135_adc_raw:m.adc_raw,mq135_gpio34_v:m.gpio_v,mq135_ao_v:m.ao_v,mq135_rs_kohm:m.rs_kohm,mq135_valid:m.valid})
  if(offset!==undefined && started!==undefined){
    const estimated=result.capture_ms+offset
    const time=new Date(estimated).toISOString()
    if(sensor==='sharp'){row.timestamp_iso=time;row.elapsed_s=(estimated-started)/1000}
    if(sensor==='mq135')row.PC_Time=time
    if(sensor==='occupancy')row.pc_timestamp_local=time
  }
  return row
}

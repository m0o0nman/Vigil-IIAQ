import type { Result } from '../src/engine'
import { co2Status, humidityStatus } from './bands'

// Firmware freshness rules, inputs/code/VIGIL_Phase3_Fixed.ino:27,22,285–300.
export const ages = { control: 15000, climate: 30000, mq: 1500, dust: 2500, inference: 20000 }
const elapsed = (now: number, then: number) => (now - then) >>> 0
export type Latest = Result & {boot_id: string, received_at: number, decision_reason: string}
export type Requested = {mode:'auto'|'off'|'freshen', expires:number}
export const modes = {auto:'Auto', off:'Off', freshen:'Freshen now'}
export const reasons: Record<string,string> = {
  stale_co2:'Local safety stopped ventilation because CO₂ is unavailable.',
  minimum_runtime:'Local safety is holding the fan on for its minimum run.',
  recovery:'Local safety is waiting for sustained CO₂ recovery.',
  co2_hold:'Local safety is keeping ventilation on while CO₂ is elevated.',
  backend:'The device is following the backend command.',
  no_command:'The device has no active backend command.',
  co2_threshold:'CO₂ reached the ventilation trigger.',
  preventive:'The backend requested preventive ventilation.',
  monitoring:'The backend is monitoring CO₂.',
  hold:'The backend is holding ventilation.',
  owner_off:'The owner requested Off.',
  owner_freshen:'The owner requested Freshen now.',
  freshen_expired:'The Freshen request expired.',
  stale_or_replay:'Current observations were unavailable for a fan command.',
}

export function statusOf(latest: Latest | null, now: number, connected: boolean) {
  const sample = latest?.sample
  const delay = latest ? Math.max(0, now - latest.received_at) : Infinity
  const deviceLive = connected && delay <= ages.control
  const scd = sample?.scd40
  const age = scd ? elapsed(sample!.uptime_ms, scd.at_ms) + delay : Infinity
  const co2 = deviceLive && scd?.control_fresh && age <= ages.control ? scd.co2_ppm : null
  const climate = deviceLive && scd?.valid && age <= ages.climate
  const rh = climate ? scd.rh_pct : null
  const temp = climate ? scd.temperature_c : null
  const dust = sample?.sharp
  const mq = sample?.mq135
  let fumes = 'Unavailable'
  let optical = 'Unavailable'
  if (deviceLive && co2 !== null && latest && mq) {
    const gas = latest.gas?.status
    if (gas === 'BASELINE_REQUIRED') fumes = 'Needs calibration'
    else if (gas === 'WARMING_UP' || gas === 'VOTE_WARMUP') fumes = 'Warming up'
    else if (mq.fresh && elapsed(sample!.uptime_ms, mq.at_ms) + delay <= ages.mq &&
      latest.gas_ready && age <= ages.inference && latest.gas) fumes = latest.gas.alert ? 'Elevated' : 'Normal'
  }
  if (deviceLive && dust && latest) {
    const liveDust = dust.fresh && elapsed(sample!.uptime_ms, dust.at_ms) + delay <= ages.dust
    if (liveDust && !latest.dust.ready) optical = 'Warming up'
    if (liveDust && latest.dust.ready) {
      const status = latest.dust.status
      optical = ['ELEVATED','HIGH_PENDING','HIGH_PERSISTENT'].includes(status) ? 'Elevated'
        : status === 'BASELINE_RANGE' ? 'Normal' : 'Check sensor'
    }
  }
  const occupancy = co2 !== null && latest?.occupancy_ready && !latest.occupancy?.outside &&
    typeof latest.occupancy?.even === 'number' && latest.occupancy.even >= 0 ? latest.occupancy.even : null
  return { deviceLive, co2, co2Band:co2Status(co2), rh, temp, humidity:humidityStatus(rh), fumes, optical, occupancy,
    connection: !connected ? 'Connection lost' : !latest ? 'Waiting for device' : deviceLive ? 'Device online' : 'Device offline',
    observation: !latest ? 'Waiting for the first device reading.' : !deviceLive ? 'The device has stopped sending current readings.'
      : !scd?.valid ? 'The CO₂ sensor reported an unavailable reading.' : 'The last CO₂ observation is stale.' }
}

export function observationTime(latest: Latest) {
  return latest.received_at - elapsed(latest.sample.uptime_ms, latest.sample.scd40.at_ms)
}

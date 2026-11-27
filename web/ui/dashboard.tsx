'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Frame, Orb } from './frame'
import { useVigil } from './live'
import { Icon } from './icon'
import { modes, reasons, statusOf } from './state'

type Mode=keyof typeof modes
export function FanControl({enabled}: {enabled:boolean}) {
  const {latest,requested,now,api}=useVigil()
  const [sending,setSending]=useState(false)
  const [pending,setPending]=useState<{mode:Mode,seq:number,boot:string,until:number}|null>(null)
  const [error,setError]=useState('')
  const [failed,setFailed]=useState<{mode:Mode,key:string}|null>(null)
  const updated=!!pending && !!latest && (latest.boot_id!==pending.boot || latest.sample.seq>pending.seq)
  const waiting=pending && !updated && now<pending.until
  const expired=requested?.mode==='freshen' && requested.expires<=now
  const actual=enabled && latest ? latest.sample : null

  async function send(mode:Mode,key:string=crypto.randomUUID()) {
    if(sending)return
    setSending(true);setError('');setFailed(null)
    try {
      await api('/api/command',{mode},key)
      setPending({mode,seq:latest?.sample.seq??0,boot:latest?.boot_id??'',until:Date.now()+15000})
    } catch {
      setError('The command could not be confirmed. The next device report shows the actual fan state.')
      setFailed({mode,key})
    } finally {setSending(false)}
  }

  return <section className="fan-section" aria-labelledby="fan-title">
    <div>
      <p className="eyebrow">Ventilation</p><h2 id="fan-title">Fan {actual ? actual.fan_on?'on':'off' : 'state unavailable'}</h2>
      <p>{actual ? reasons[actual.fan_reason] ?? 'Device state reported.' : 'Waiting for a current device report.'}</p>
      {actual?.local_override && <p className="notice">Local CO₂ safety takes precedence over your requested mode.</p>}
    </div>
    <div className="fan-actions">
      <p>Requested mode <strong>{expired?'Freshen expired':requested?modes[requested.mode]:'Unavailable'}</strong></p>
      <div className="segmented" aria-label="Request fan mode">
        {(Object.entries(modes) as [Mode,string][]).map(([mode,label])=>
          <button type="button" key={mode} aria-pressed={!expired && requested?.mode===mode}
            disabled={sending} onClick={()=>void send(mode)}>{label}</button>)}
      </div>
      <p className="support" role="status">{sending?'Sending request…':waiting?`${modes[pending.mode]} requested. Waiting for device telemetry.`
        :pending&&!updated?'No newer device report yet.'
        :pending?'New device report received. See the actual state.':''}</p>
      {error && <div role="alert" className="notice">{error}{' '}
        {failed && <button className="button compact" onClick={()=>void send(failed.mode,failed.key)}>Retry command</button>}
      </div>}
    </div>
  </section>
}

export function Dashboard() {
  const state=useVigil()
  const {latest,now,connected,liveReady,liveError,lastValid,calibrating}=state
  const view=statusOf(latest,now,connected)
  const provisionalDust=latest?.versions.includes('sharp=v0')
  const dustStatus=provisionalDust && view.optical==='Normal'?'Needs calibration':view.optical
  const forecast=latest?.forecast
  const projection=view.co2===null?null:forecast?.robust??forecast?.linear??forecast?.persistence??null
  const unavailable=!liveReady?'Waiting for live data…':liveError?'The live feed could not be read.':
    view.observation
  return <Frame>
    <div className="dashboard">
      {calibrating && <div className="banner"><span>Calibration in progress</span><Link href="/calibrate">View progress <Icon name="arrow"/></Link></div>}
      <section className="room-status">
        <div className="room-copy">
          <p className="eyebrow">Carbon dioxide</p>
          <h1 className="status-title" data-band={view.co2Band?.key}>
            <span className="status-mark" aria-hidden="true"/>{view.co2Band?.label??'Unavailable'}
          </h1>
          <p className="co2-reading">{view.co2===null?'—':view.co2.toLocaleString()} <span>ppm CO₂</span></p>
          <p className="intro">{view.co2Band?.description??unavailable}</p>
          <p className="support">{lastValid!==null? 'Last valid CO₂ · '+new Date(lastValid).toLocaleString(): 'Waiting for a valid CO₂ observation.'}</p>
        </div>
        <Orb active={view.co2!==null}/>
      </section>
      <section className="measurements" aria-label="Room measurements">
        <div><h2>Occupancy</h2><p>{view.occupancy===null?'Unavailable':<><span className="occupancy-context">About </span>{view.occupancy}<span className="occupancy-context"> people</span></>}</p><small>CO₂-based estimate</small></div>
        <div><h2>Climate</h2><p>{view.temp===null?'—':view.temp.toFixed(1)+' °C'}</p>
          <small>{view.rh===null?'Humidity unavailable':`${view.rh.toFixed(0)}% RH · ${view.humidity}`}</small></div>
        <div><h2>Fumes</h2><p className="sensor-word">{view.fumes}</p><small>Gas-response sensor</small></div>
        <div><h2>Dust</h2><p className="sensor-word">{dustStatus}</p><small>{provisionalDust?'Provisional optical reference':'Optical response sensor'}</small></div>
      </section>
      <FanControl enabled={view.deviceLive}/>
      <div className="dashboard-foot"><p>{projection!==null?`10-minute CO₂ forecast · ${Math.round(projection)} ppm`:'CO₂ forecast unavailable'}</p><Link href="/details" className="button">See details <Icon name="arrow"/></Link></div>
    </div>
  </Frame>
}

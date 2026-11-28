'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState, type ReactNode } from 'react'
import { bands } from './bands'
import { Chart } from './chart'
import { useVigil } from './live'
import { Icon } from './icon'
import { modes, reasons, recentRows, statusOf } from './state'

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
      <div className="fan-label"><p className="eyebrow">Intelligent ventilation</p><span className="fan-icon" data-running={actual?.fan_on===true}><Icon name="fan"/></span></div><h2 id="fan-title">Fan {actual ? actual.fan_on?'on':'off' : 'state unavailable'}</h2>
      <p>{actual ? reasons[actual.fan_reason] ?? 'Device state reported.' : 'Waiting for a current device report.'}</p>
      {actual?.local_override && <p className="notice">Local CO₂ safety takes precedence over your requested mode.</p>}
    </div>
    <div className="fan-actions">
      <p className="mode-label">Requested mode <strong>{expired?'Freshen expired':requested?modes[requested.mode]:'Unavailable'}</strong></p>
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

function Reading({children, value}: {children: ReactNode, value: number|null}) {
  return <span className={value===null ? '' : 'reading-change'} key={value}>{children}</span>
}

const co2Series = [{key:'ppm', label:'Observed CO₂', colour:'var(--text)'}]

function Portrait() {
  return <figure className="portrait card">
    <div className="portrait-image"><Image src="/brand/editorial/roger-waters.webp" alt="Roger Waters on stage with his guitar"
      fill sizes="(max-width: 650px) 100vw, (max-width: 990px) 45vw, 320px" /></div>
    <figcaption><blockquote>“Don't be afraid to Care”</blockquote><cite>— Roger Waters</cite></figcaption>
  </figure>
}

export function Dashboard() {
  const {latest, recent, now, connected, liveReady, liveError, lastValid, calibrating} = useVigil()
  const view = statusOf(latest, now, connected && liveReady && !liveError)
  const rows = useMemo(() => recentRows(recent, latest), [recent, latest])
  const provisionalDust = latest?.versions.includes('sharp=v0')
  const dust = provisionalDust && view.optical==='Normal' ? 'Needs calibration' : view.optical
  const forecast = latest?.forecast
  const projection = view.co2===null ? null : forecast?.robust??forecast?.linear??forecast?.persistence??null
  const forecastMethod = forecast?.robust!=null ? 'Robust' : forecast?.linear!=null ? 'Linear' : 'Persistence'
  const unavailable = !liveReady ? 'Waiting for live data…' : liveError ? 'The live feed could not be read.' : view.observation
  const band = view.co2Band
  const versionSummary = latest?.versions.split(';').filter(item => /^(occupancy|sharp|mq135)=/.test(item))
  const updated = versionSummary?.filter(item => !item.endsWith('=v0')).length
  return <div className="dashboard">
    <div className="dashboard-title"><h1>Room overview</h1>
      <Link href="/details" className="button subtle" aria-label="See details"><span>See details</span> <Icon name="external"/></Link>
    </div>
    <div className="overview">
      <section className="condition" data-band={band?.key}>
        <h2><i className="status-dot"/>{band?.label ?? 'Unavailable'}</h2>
        <p>{band?.description ?? unavailable}</p>
        {band && <div className="band-scale" aria-hidden="true">{bands.co2.map(item=>
          <i key={item.key} style={item.key===band.key?{backgroundColor:'var(--status-'+item.key+')'}:undefined}/>)}</div>}
        <details className="observation" open={view.co2===null || undefined}><summary>Observation time</summary><p>{lastValid!==null
          ? 'Last valid CO₂ · '+new Date(lastValid).toLocaleString() : 'Waiting for a valid CO₂ observation.'}</p></details>
      </section>
      <div className="stat"><div className="stat-label"><Icon name="air"/>Carbon dioxide</div>
        <p><Reading value={view.co2}>{view.co2?.toLocaleString()??'—'}</Reading><small>ppm</small></p></div>
      <div className="stat"><div className="stat-label"><Icon name="people"/>Occupancy</div>
        <p><Reading value={view.occupancy}>{view.occupancy!==null && <><span className="sr-only">About </span><span className="approx" aria-hidden="true">≈</span></>}{view.occupancy??'—'}</Reading><small>{view.occupancy===null?'Unavailable':'people'}</small></p>
        {view.occupancy!==null && <span className="stat-note">CO₂-based estimate</span>}</div>
      <div className="stat"><div className="stat-label"><Icon name="climate"/>Climate</div>
        <p><Reading value={view.temp}>{view.temp?.toFixed(1)??'—'}</Reading><small>°C</small></p>
        <span className="stat-note">{view.rh===null?'Humidity unavailable':view.rh.toFixed(0)+'% RH · '+view.humidity}</span></div>
    </div>
    <div className="bento">
      <Portrait/>
      <section className="trend card">
        <div className="card-head"><h2>CO₂ history</h2><Link className="icon-button" href="/details" aria-label="Open CO₂ analytics"><Icon name="external"/></Link></div>
        <p className="support">{view.deviceLive?'Five-minute window':'Last recorded five minutes'} · ppm</p>
        {rows.some(row=>row.ppm!=null)
          ? <Chart compact title="CO₂ over device uptime" rows={rows} unit="ppm" series={co2Series} animate={view.co2!==null}/>
          : <p className="plot-empty">{liveReady?'No observed CO₂ history available.':'Loading observed history…'}</p>}
        <div className="projection"><div><span>10-minute forecast</span>
          <small>{projection===null?'Forecast unavailable':forecastMethod+' prediction'}</small></div>
          <p><Reading value={projection}>{projection===null?'—':Math.round(projection)}</Reading> <small>ppm</small></p></div>
      </section>
      <FanControl enabled={view.deviceLive}/>
      <section className="responses card">
        <h2>Sensor response</h2>
        {[
          {label:'Fumes', source:'MQ135 gas response', status:view.fumes, icon:'air' as const},
          {label:'Dust', source:provisionalDust?'Provisional optical reference':'Sharp optical response', status:dust, icon:'dust' as const},
        ].map(sensor=><div className="response-row" key={sensor.label}>
          <span className="sensor-icon"><Icon name={sensor.icon}/></span>
          <div><h3>{sensor.label}</h3><small>{sensor.source}</small></div>
          <span className="sensor-state" data-status={sensor.status}>{sensor.status}</span></div>)}
      </section>
      <section className="calibration-card card">
        <div className="card-head"><h2>Calibration</h2><Icon name="sliders"/></div>
        <p>{calibrating?'Session in progress':updated==null?'Versions unavailable':updated===0?'Original references':updated+' updated '+(updated===1?'reference':'references')}</p>
        <Link className="text-link" href="/calibrate">{calibrating?'View progress':'Calibrate sensors'} <Icon name="arrow"/></Link>
      </section>
      <section className="insights card">
        <h2>Environmental insights</h2>
        <details><summary>Understanding CO₂</summary><p>VIGIL assigns the room’s CO₂ reading to a monitoring band. Humidity, optical response and gas response are measured separately.</p></details>
        <details><summary>Reading the forecast</summary><p>VIGIL projects CO₂ ten minutes ahead. Details shows each method alongside the observations that arrived later.</p></details>
      </section>
    </div>
  </div>
}

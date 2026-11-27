'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { CalibrationArchive } from '../src/readback'
import { Download, Restore, useRead } from './actions'
import { Frame } from './frame'
import { useVigil } from './live'
const names:Record<string,string>={occupancy:'Occupancy',mq135:'Fumes',sharp:'Dust',forecast:'CO₂ forecast'}

function SettingsPanel() {
  const {signOut,calibrating}=useVigil()
  const {data,error,pending,reload}=useRead<CalibrationArchive>('/api/calibrate/status?view=history')
  const [failed,setFailed]=useState(false)
  return <div className="page-section">
    <div className="page-heading"><p className="eyebrow">Owner controls</p><h1>Settings</h1>
      <div className="actions">
        <Link className="button primary" href="/calibrate">{calibrating?'Resume calibration':'Calibrate'}</Link>
        <button className="button" onClick={()=>void signOut().catch(()=>setFailed(true))}>Sign out</button>
      </div>
      {failed&&<p role="alert">Sign-out failed. Try again.</p>}
    </div>
    {error&&<p className="notice" role="alert">{error} <button className="button compact" onClick={reload}>Retry</button></p>}
    {pending&&<p role="status">Loading versions and calibration history…</p>}
    <h2>Active versions</h2>
    {data&&Object.keys(data.active).length?<dl className="value-list">
      {Object.entries(data.active).map(([model,version])=><div key={model}><dt>{names[model]??model}</dt><dd className="version">{version}</dd></div>)}
    </dl>:!pending&&<p>Active versions are unavailable.</p>}
    <div className="section-heading"><h2>Calibration history</h2><p>Most recent 20 sessions</p></div>
    {data?.entries.length===0&&<p>No calibration sessions yet.</p>}
    {data?.entries.map(entry=><details className="disclosure" key={entry.id}>
      <summary>{names[entry.sensor]??entry.sensor} · {entry.status} · {new Date(entry.started).toLocaleDateString()}</summary>
      <p className="version">{entry.id}</p>
      <div className="actions"><Download id={entry.id}/>
        {entry.status==='passed'&&entry.source&&data.active[entry.sensor]===entry.id&&
          <Restore model={entry.sensor} version={entry.source} onRestored={reload}/>}
      </div>
    </details>)}
    <p className="support">Calibration gates are provisional. Occupancy remains an estimate after recalibration.</p>
  </div>
}
export function Settings() {return <Frame><SettingsPanel/></Frame>}

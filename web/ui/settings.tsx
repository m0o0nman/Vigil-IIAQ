'use client'

import Link from 'next/link'
import { useState } from 'react'
import type { CalibrationArchive } from '../src/readback'
import { Download, Restore, useRead } from './actions'
import { useVigil } from './live'
const names:Record<string,string>={occupancy:'Occupancy',mq135:'Fumes',sharp:'Dust',forecast:'CO₂ forecast'}

export function Settings() {
  const {signOut,calibrating}=useVigil()
  const {data,error,pending,reload}=useRead<CalibrationArchive>('/api/calibrate/status?view=history')
  const [restored,setRestored]=useState(false)
  const [failed,setFailed]=useState(false)
  return <div className="page-section">
    <div className="page-heading"><p className="eyebrow">Owner controls</p><h1>Settings</h1>
      <div className="actions">
        <Link className="button primary" href="/calibrate">{calibrating?'Resume calibration':'Calibrate'}</Link>
        <button className="button" onClick={()=>void signOut().catch(()=>setFailed(true))}>Sign out</button>
      </div>
      {failed&&<p role="alert">Sign-out failed. Try again.</p>}
    </div>
    {restored&&<p className="notice" role="status">Previous version restored.</p>}
    {error&&<p className="notice" role="alert">{error} <button className="button compact" onClick={reload}>Retry</button></p>}
    {pending&&<p className="loading" role="status">Loading versions and calibration history…</p>}
    <div className="settings-grid"><section className="settings-panel"><h2>Active versions</h2>
    {data&&Object.keys(data.active).length?<dl className="value-list">
      {Object.entries(data.active).map(([model,version])=><div key={model}><dt>{names[model]??model}</dt><dd className="version">{version}</dd></div>)}
    </dl>:!pending&&<p>Active versions are unavailable.</p>}
    </section><section className="settings-panel"><h2>Calibration history</h2><p className="support">Most recent 20 sessions</p>
    {data?.entries.length===0&&<p>No calibration sessions yet.</p>}
    {data?.entries.map(entry=><details className="disclosure" key={entry.id}>
      <summary>{names[entry.sensor]??entry.sensor} · {entry.status} · {new Date(entry.started).toLocaleDateString()}</summary>
      <p className="version">{entry.id}</p>
      <div className="actions"><Download id={entry.id}/>
        {entry.status==='passed'&&entry.source&&data.active[entry.sensor]===entry.id&&
          <Restore model={entry.sensor} version={entry.source} onRestored={()=>{setRestored(true);reload()}}/>}
      </div>
    </details>)}
    </section></div>
    <p className="support">Calibration gates are provisional. Occupancy remains an estimate after recalibration.</p>
  </div>
}

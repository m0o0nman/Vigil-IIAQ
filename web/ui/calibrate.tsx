'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, Restore, useRead } from './actions'
import { Frame, Orb } from './frame'
import { RequestError, useVigil } from './live'
import type { CalibrationArchive } from '../src/readback'
import type { summary } from '../src/session'

const sensors = {
  occupancy: {name:'Occupancy',guide:'Leave the room empty and keep the air steady. VIGIL uses CO₂ as the room’s reference.'},
  mq135: {name:'Fumes',guide:'Let the gas-response sensor warm up. Keep it away from smoke, sprays and changing temperature or humidity.'},
  sharp: {name:'Dust',guide:'Keep dust and airflow steady so the optical sensor can measure its reference response.'},
} as const
const embed='https://www.youtube-nocookie.com/embed/jcz0YxYl6Ac'
const watch='https://www.youtube.com/watch?v=jcz0YxYl6Ac'
type Sensor=keyof typeof sensors
type Progress = Partial<Omit<ReturnType<typeof summary>,'status'>> & { status:string,session?:string|null }

function BreathBreak() {
  const [player,setPlayer]=useState(false)
  return <aside className="breath-break">
    <Orb/><div className="prism" aria-hidden="true"><i/><i/><i/></div>
    <h2>Let the room settle.</h2>
    <p>Relax your shoulders. Take one easy breath.</p>
    {!player ? <button className="button" onClick={()=>setPlayer(true)}>Open music player</button> :
      <iframe src={embed} title="Pink Floyd — Breathe (In The Air) (2023 Remaster)"
        allow="encrypted-media; picture-in-picture" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen/>}
    <p className="support">If the player is unavailable, take a quiet breath or <a href={watch} target="_blank" rel="noreferrer">open Pink Floyd on YouTube ↗</a>.</p>
  </aside>
}

function CalibrationPanel() {
  const {api,calibrating,connected,latest}=useVigil()
  const [sensor,setSensor]=useState<Sensor>('occupancy')
  const [confirmed,setConfirmed]=useState(false)
  const [progress,setProgress]=useState<Progress|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [readError,setReadError]=useState(false)
  const [refresh,setRefresh]=useState(0)
  const retry=useRef<{action:string,body:object,key:string}|null>(null)
  const active=progress?.status==='warmup'||progress?.status==='measuring'||progress?.status==='collecting'
  const archive=useRead<CalibrationArchive>(progress?.status==='passed'?'/api/calibrate/status?view=history':null)
  const selectedSensor=active && progress?.sensor ? progress.sensor : sensor

  useEffect(()=>{
    let current=true
    async function load(){
      try{
        const value=await api<Progress>('/api/calibrate/status')
        if(current){setProgress(value);setReadError(false)}
      }catch{if(current)setReadError(true)}
    }
    void load()
    const timer=active||calibrating?window.setInterval(()=>void load(),5000):null
    return ()=>{current=false;if(timer!==null)window.clearInterval(timer)}
  },[api,active,calibrating,refresh])

  async function act(action:'start'|'abort',body:object) {
    const previous=retry.current
    const key=previous?.action===action && JSON.stringify(previous.body)===JSON.stringify(body) ? previous.key : crypto.randomUUID()
    setBusy(true);setError('')
    try{
      const value=await api<Progress>('/api/calibrate/'+action,body,key)
      retry.current=null
      setProgress(value);setRefresh(n=>n+1)
    }catch(e){
      retry.current=e instanceof RequestError && e.status<500?null:{action,body,key}
      setError(e instanceof RequestError?e.message:'The service could not confirm the calibration request.')
      setRefresh(n=>n+1)
    }finally{setBusy(false)}
  }

  const terminal=!!progress && ['passed','failed','aborted'].includes(progress.status)
  const passed=progress?.status==='passed'
  const evaluating=progress?.window_required_ms!==undefined && (progress.window_elapsed_ms??0)>=progress.window_required_ms
  const readyToStart=progress!==null && !readError
  const percent=progress?.window_required_ms ? Math.min(100,100*(progress.window_elapsed_ms??0)/progress.window_required_ms) : null
  const step=terminal?5:progress?.status==='measuring'||progress?.status==='collecting'?2:active?1:0
  const previousActive=progress?.sensor && archive.data?.active[progress.sensor]===progress.session
  return <div className="page-section">
    <div className="page-heading"><p className="eyebrow">Sensor setup</p><h1>Calibrate</h1>
      <p>Give each sensor a stable reference for this room.</p></div>
    <div className="calibration-layout">
      <div className="calibration-main">
        <ol className="steps" aria-label="Calibration stages">
          {['Preparation','Warm-up','Measurement','Stability','Quality','Result'].map((name,index)=>
            <li key={name} aria-current={index===step?'step':undefined} data-complete={index<step && (!terminal||index===0||evaluating)}>{name}</li>)}
        </ol>
        {readError && <div className="notice" role="alert">Calibration status is unavailable. <button className="button compact" onClick={()=>setRefresh(n=>n+1)}>Retry status</button></div>}
        {!progress&&!readError&&<p role="status">Loading calibration status…</p>}
        {active ? <section className="light-panel" aria-label="Current calibration">
          <p className="eyebrow">{sensors[selectedSensor].name}</p>
          <h2>{step===1?'Sensor warm-up':'Measuring a stable window'}</h2>
          <p>{sensors[selectedSensor].guide}</p>
          {step===1?<p>{progress.observations??0} observations received.</p>:percent!==null&&<>
            <progress value={percent} max={100} aria-label="Measured calibration window"/>
            <p>{((progress.window_elapsed_ms??0)/1000).toFixed(0)} of {(progress.window_required_ms??0)/1000} seconds measured · {progress.distinct_scd??0} distinct CO₂ samples</p>
          </>}
          {!connected && <p className="notice">Live connection lost. Waiting for a backend update.</p>}
          <p className="support" role="status">{step===1?'The backend is waiting for warm-up evidence.':'The backend evaluates stability and quality when the measurement window closes.'}</p>
          {progress.session&&<button className="button" disabled={busy} onClick={()=>void act('abort',{session:progress.session})}>Abort calibration</button>}
        </section>:<>
          {terminal&&<section className="light-panel outcome" aria-live="polite">
            <p className="eyebrow">Calibration result</p>
            <h2>{passed?'Calibration active':progress.status==='aborted'?'Calibration aborted':'Calibration failed'}</h2>
            <p>{passed?'The backend activated the new reference.':
              'The previous working version remains active.'}</p>
            {progress.reason&&<p>{progress.reason}</p>}
            {progress.sensor==='occupancy'&&passed&&<p>Occupancy remains an approximate estimate.</p>}
            {progress.warnings?.map(warning=><p className="notice" key={warning}>{warning}</p>)}
            {progress.gates&&Object.keys(progress.gates).length>0&&<details>
              <summary>Stability and quality checks</summary>
              <ul>{Object.entries(progress.gates).map(([name,gate])=><li key={name}>{name.replaceAll('_',' ')} · {gate.ok?'Passed':'Failed'} · {String(gate.measured)}</li>)}</ul>
            </details>}
            <div className="actions">
              {progress.session&&<Download id={progress.session}/>}
              {previousActive&&progress.source&&progress.sensor&&
                <Restore model={progress.sensor} version={progress.source} onRestored={archive.reload}/>}
            </div>
          </section>}
          <form className="form-stack" onSubmit={event=>{
            event.preventDefault();void act('start',{sensor,conditions_confirmed:confirmed})
          }}>
            <label>Sensor<select value={sensor} onChange={e=>{setSensor(e.target.value as Sensor);setConfirmed(false)}}>
              {Object.entries(sensors).map(([value,option])=><option value={value} key={value}>{option.name}</option>)}
            </select></label>
            <p>{sensors[sensor].guide}</p>
            {latest&&<p className="support">Reported version · {latest.versions.split(';').find(value=>value.startsWith(sensor+'='))?.split('=')[1]??'Unavailable'}</p>}
            <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
              <span>I’ve confirmed the room is empty and its airflow is stable.</span></label>
            <button className="button primary" disabled={!confirmed || busy || !readyToStart}>{busy?'Sending…':terminal&&progress.status==='failed'?'Retry calibration':terminal?'Start another calibration':'Start calibration'}</button>
          </form>
        </>}
        {error&&<p role="alert" className="notice">{error}</p>}
      </div>
      <BreathBreak/>
    </div>
  </div>
}

export function Calibrate() {return <Frame><CalibrationPanel/></Frame>}

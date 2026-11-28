'use client'
// Synthetic presentation harness, loaded only by a temporary local test route.
import { useEffect, useState } from 'react'
import { VigilContext, type VigilState } from '../ui/live'
import { Welcome } from '../ui/welcome'
import { Dashboard } from '../ui/dashboard'
import { Calibrate } from '../ui/calibrate'
import { Details } from '../ui/details'
import { Settings } from '../ui/settings'
import { Frame } from '../ui/frame'
import type { Latest, Requested } from '../ui/state'

const boot='00112233445566778899aabbccddeeff'
const session='11111111-2222-4333-8444-555555555555'
const time=1795781150000
const rows=Array.from({length:80},(_,i)=>({
  t:60000+i*15000,scd:60000+i*15000,co2:Math.round(530+1.2*i+20*Math.sin(i/9)),
  people:2+2*Math.sin(i/12)**2,temperature:24+.3*Math.sin(i/10),humidity:48+.9*Math.cos(i/12),
  dustOn:1450+18*Math.sin(i),dustFiltered:1451+3*Math.cos(i/9),fan:i>58&&i<66,fanReason:'backend',gap:0,
  forecast:{persistence:570+i/2,linear:560+i/3,robust:565+i*.4}
}))
export default function Fixture() {
  const [screen,setScreen]=useState('')
  useEffect(()=>setScreen(new URLSearchParams(window.location.search).get('screen')??'welcome'),[])
  const [requested,setRequested]=useState<Requested>({mode:'auto',expires:0})
  const [progress,setProgress]=useState({status:'idle',session:null as string|null,sensor:'occupancy',
    observations:45,distinct_scd:8,window_elapsed_ms:34000,window_required_ms:60000})
  const [fail,setFail]=useState(false)
  const age=screen==='stale'?20000:0
  const latest={
    boot_id:boot,received_at:time,versions:'occupancy=v0;mq135=v0;sharp=v0;forecast=v0',decision_reason:'monitoring',
    sample:{seq:120,uptime_ms:1200000,fan_on:screen==='override',local_override:screen==='override',fan_reason:screen==='override'?'minimum_runtime':'no_command',
      scd40:{at_ms:1199800,co2_ppm:584,temperature_c:24.1,rh_pct:48,valid:true,control_fresh:true},
      mq135:{at_ms:1199950,valid:true,fresh:true,adc_raw:410,gpio_v:.46,ao_v:.92,rs_kohm:4.43},
      sharp:{at_ms:1200000,valid:true,fresh:true,on_mv:1478,off_mv:820,delta_mv:658,max_pulse_us:324}},
    dust:{ready:true,filtered:1475,status:'BASELINE_RANGE'},gas:{status:'BASELINE_REQUIRED'},gas_ready:false,
    occupancy:{even:2,outside:false},occupancy_ready:true,forecast:{persistence:584,linear:600,robust:596}
  } as unknown as Latest
  const shown=screen==='missing'?null:latest
  const state:VigilState={
    access: screen==='login'?'signed-out':screen==='blocked'?'unauthorized':'owner',
    connected:true,liveReady:true,liveError:false,now:time+age,latest:shown,lastValid:shown?time-200:null,
    requested,calibrating:progress.session,
    async signIn(){throw Error('synthetic auth error')},async signOut(){},retry(){},
    async api<T>(path:string,body?:object):Promise<T>{
      let value:unknown=progress
      if(path.includes('view=analytics')){
        value={rows,metrics:{linear:{n:0,mae:null,rmse:null,bias:null},robust:{n:0},persistence:{n:0}}}
      }
      if(path.includes('view=history'))value={entries:[{id:session,sensor:'occupancy',status:'passed',started:time,source:'v0'}],active:{occupancy:session,sharp:'v0',mq135:'v0'}}
      if(path==='/api/command'){
        if(screen==='fail'&&!fail){setFail(true);throw Error('synthetic command failure')}
        const mode=(body as {mode:Requested['mode']}).mode
        value={mode,expires:mode==='freshen'?time+10000:0}
        setRequested(value as Requested)
      }
      if(path==='/api/calibrate/start'){
        value={...progress,status:'measuring',session,sensor:(body as {sensor:string}).sensor}
        setProgress(value as typeof progress)
      }
      if(path==='/api/calibrate/abort'){
        value={...progress,status:'aborted'}
        setProgress(value as typeof progress)
      }
      return value as T
    },
    async download(){},
  }
  return <VigilContext.Provider value={state}><div style={{position:'fixed',inset:'auto 12px 10px auto',zIndex:40,padding:'5px 10px',background:'var(--text)',color:'var(--background)',borderRadius:8,fontSize:12}}>Synthetic test data</div>
    {screen==='welcome'?<Welcome/>:screen==='calibrate'?<Calibrate/>:screen==='details'?<Details/>:screen==='settings'?<Settings/>:
      screen==='login'||screen==='blocked'?<Frame>{null}</Frame>:<Dashboard/>}
  </VigilContext.Provider>
}

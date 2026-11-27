import {approved, dustState,dustStep,gasState,gasStep,occupancyStep,predict, type Point,type Specs} from './models'
import {elapsed,Failure,type Batch,type Sample} from './protocol'
export type Mode='auto'|'off'|'freshen'
export type Command={mode:Mode,expires:number}
const aggregate=()=>({n:0,sum:0,absolute:0,squares:0})
type Prediction=ReturnType<typeof predict>
const names=['robust','linear','persistence'] as const
export const initial=()=>({
  seq:0,raw:0,time:0,drops:0,gaps:0,offset:null as number|null,
  version:'',anchor:'',lastMq:0,lastPairedMq:0,occ:[] as Point[],gas:gasState(),dust:dustState(),trend:[] as Point[],
  lastScd:null as number|null,occOutput:null as ReturnType<typeof occupancyStep>|null,
  gasOutput:null as ReturnType<typeof gasStep>|null,forecast:null as Prediction|null,
  pending:[] as {target:number,prediction:Prediction}[], missed:0,
  totals:{robust:aggregate(),linear:aggregate(),persistence:aggregate()},
  fan:{on:false,start:0,recovery:null as number|null,votes:0},
})
export type State=ReturnType<typeof initial>
function reset(s:State){
  const blank=initial()
  Object.assign(s,{occ:[],trend:[],gas:blank.gas,dust:blank.dust,lastScd:null,
    occOutput:null,gasOutput:null,forecast:null,pending:[],fan:blank.fan})
}
export function metrics(s:State){
  return Object.fromEntries(names.map(k=>{
    const a=s.totals[k]
    return [k,{n:a.n,mae:a.n?a.absolute/a.n:null,rmse:a.n?Math.sqrt(a.squares/a.n):null,bias:a.n?a.sum/a.n:null}]
  }))
}
export function match(s:State,t:number,y:number){
  for(const p of s.pending){
    if(p.target<t){s.missed++;continue}
    // Compare all three methods on the same origin/target pairs.
    if(p.target!==t || names.some(k=>p.prediction[k]===null))continue
    for(const k of names){
      const v=p.prediction[k]
      if(v===null)continue
      const e=v-y,a=s.totals[k];a.n++;a.sum+=e;a.squares+=e*e;a.absolute+=Math.abs(e)
    }
  }
  s.pending=s.pending.filter(p=>p.target>t)
}
// Classic firmware F204–230. State advances only on distinct fresh readings.
function ventilation(s:State,t:number,ppm:number,rate:number|null,linear:number|null){
  const f=s.fan
  f.votes=ppm>=850&&rate!==null&&rate>=5&&linear!==null&&linear>=1000?Math.min(3,f.votes+1):0
  if(!f.on&&(ppm>=1000||f.votes>=3)){f.on=true;f.start=t;f.recovery=null}
  if(f.on){
    f.recovery=ppm<750?(f.recovery??t):null
    if(t-f.start>=120000&&f.recovery!==null&&t-f.recovery>=180000){
      f.on=false;f.recovery=null;f.votes=0
    }
  }
}
export function process(s:State,r:Sample,b:Batch,versions:string,spec:Specs=approved){
  if(r.seq<=s.seq)throw new Failure(409,'Sequence already processed')
  const advance=s.seq?elapsed(r.uptime_ms,s.raw):r.uptime_ms
  if(s.seq&&advance>=0x80000000)throw new Failure(409,'Capture clock regressed')
  const gap=r.seq-s.seq-1
  if(gap>Math.max(0,b.dropped_total-s.drops))throw new Failure(409,'Preceding records required')
  if(gap||s.version!==versions){
    reset(s)
    if(s.version!==versions)s.totals=initial().totals
  }
  const identity=JSON.stringify(b.legacy_mq_reference)
  if(identity!==s.anchor){s.gas=gasState();s.gasOutput=null;s.anchor=identity}
  s.gaps+=gap;s.seq=r.seq;s.raw=r.uptime_ms;s.time+=advance;s.version=versions
  const c=r.scd40,d=r.sharp,m=r.mq_at_scd
  for(const [key,seq] of [['lastMq',r.mq135.seq],['lastPairedMq',m.seq]] as const){
    if(s[key] && elapsed(seq,s[key])>=0x80000000)throw new Failure(409,'MQ sequence regressed')
    s[key]=seq
  }
  const dust=dustStep(s.dust,s.time-elapsed(r.uptime_ms,d.at_ms),d.on_mv,d.valid,spec.sharp)
  if(c.control_fresh){
    const t=s.time-elapsed(r.uptime_ms,c.at_ms)
    if(s.lastScd!==t){
      if(s.lastScd!==null&&t<s.lastScd)throw new Failure(409,'SCD clock regressed')
      if(s.lastScd!==null&&t-s.lastScd>15000){s.fan=initial().fan;s.trend=[]}
      const ppm=c.co2_ppm!
      match(s,t,ppm)
      s.lastScd=t;s.occOutput=occupancyStep(s.occ,t,ppm,spec.occupancy)
      s.gasOutput=gasStep(s.gas,t,m.seq,elapsed(c.at_ms,m.at_ms),m.valid?m.rs_kohm:null,c.temperature_c!,c.rh_pct!,b.legacy_mq_reference,spec.mq135,c.at_ms)
      s.trend.push({t,y:ppm});s.trend=s.trend.slice(-61)
      s.forecast=predict(s.trend,s.occOutput,spec.forecast)
      s.pending.push({target:t+60000*spec.forecast.horizon_minutes,prediction:s.forecast})
      ventilation(s,t,ppm,s.occOutput.rate,s.forecast.linear)
    }
  }else{
    s.forecast=null;s.fan=initial().fan
    if(!c.valid){s.occ=[];s.gas=gasState();s.occOutput=null;s.gasOutput=null;s.trend=[]}
  }
  const gasReady=c.control_fresh && r.mq135.fresh && s.gas.votes.length===spec.mq135.window && s.time-s.gas.last<=spec.mq135.gap_ms
  return {sample:r,capture_ms:s.time,dust,occupancy:s.occOutput,gas:s.gasOutput,gas_ready:gasReady,
    occupancy_ready:c.control_fresh && s.occOutput?.estimate!=null,
    legacy_mq_reference:b.legacy_mq_reference,forecast:s.forecast,versions,
    gap,requested_auto_on:s.fan.on,auto_reason:!c.control_fresh?'stale_co2':!s.fan.on?'monitoring':
      c.co2_ppm!>=1000?'co2_threshold':s.fan.votes>=3?'preventive':s.fan.recovery!==null?'recovery':'hold'}
}
export type Result=ReturnType<typeof process>
export function decision(cmd:Command,latest:Result|null,now:number,eligible:boolean){
  if(!eligible||!latest?.sample.scd40.control_fresh)return {mode:'off',fan_cmd:'off',fan_seconds:0,reason:'stale_or_replay'}
  if(cmd.mode==='off')return {mode:'off',fan_cmd:'off',fan_seconds:0,reason:'owner_off'}
  if(cmd.mode==='freshen'){
    const seconds=Math.max(0,Math.floor((cmd.expires-now)/1000))
    return seconds?{mode:'freshen',fan_cmd:'on',fan_seconds:seconds,reason:'owner_freshen'}:
      {mode:'off',fan_cmd:'off',fan_seconds:0,reason:'freshen_expired'}
  }
  return {mode:'auto',fan_cmd:latest.requested_auto_on?'on':'off',fan_seconds:latest.requested_auto_on?10:0,reason:latest.auto_reason}
}

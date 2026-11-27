import occupancy from '../../training/specs/occupancy.json'
import mq135 from '../../training/specs/mq135.json'
import sharp from '../../training/specs/sharp.json'
import forecast from '../../training/specs/forecast.json'

export const approved = {occupancy, mq135, sharp, forecast}
export type Specs = typeof approved
export type Point = {t:number,y:number}
export type Anchor = {model_sig:number,r0:number|null,x0:number|null,t0:number|null,h0:number|null}
export function median(values:number[]) {
  const a=[...values].sort((x,y)=>x-y), mid=Math.floor(a.length/2)
  return a.length%2?a[mid]:(a[mid-1]+a[mid])/2
}
export function occupancyStep(points:Point[], t:number,y:number,s=occupancy) {
  const p=s.parameters
  if(points.length && t-points.at(-1)!.t>s.gap_reset_ms) points.length=0
  points.push({t,y})
  while(points.length>s.window_capacity || t-points[0].t>1000*p.HISTORY_SECONDS) points.shift()
  const mean=points.reduce((a,b)=>a+b.y,0)/points.length, delta=mean-p.HISTORICAL_EMPTY_CO2_PPM
  if(points.length<s.min_samples || t-points[0].t<1000*p.MIN_HISTORY_SECONDS)
    return {mean,delta,rate:null,estimate:null,even:-1,outside:false}
  const mid=points.reduce((a,b)=>a+b.t,0)/points.length
  const rate=60000*points.reduce((a,b)=>a+(b.t-mid)*(b.y-mean),0)/points.reduce((a,b)=>a+(b.t-mid)**2,0)
  const estimate=Math.max(0,Math.min(p.MAX_PEOPLE,p.INTERCEPT+p.BETA_DELTA*delta/p.DELTA_SCALE_PPM+p.BETA_RATE*rate/p.RATE_SCALE_PPM_PER_MIN))
  return {mean,delta,rate,estimate,even:2*Math.round(estimate/2),outside:delta<p.TRAIN_DELTA_MIN||delta>p.TRAIN_DELTA_MAX||rate<p.TRAIN_RATE_MIN||rate>p.TRAIN_RATE_MAX}
}
export const gasState=()=>({last:0,used:0,ewma:0,votes:[] as boolean[]})
export function signature(s= mq135) {
  const data=new DataView(new ArrayBuffer(4))
  let h=2166136261
  for(const n of [...s.beta,s.residual_median,s.residual_scale,s.alpha,s.limit]){
    data.setFloat32(0,n,true); h=Math.imul(h^data.getUint32(0,true),16777619)>>>0
  }
  return h
}
export function gasStep(st:ReturnType<typeof gasState>,now:number,seq:number,age:number,rs:number|null,t:number,h:number,a:Anchor|null,s=mq135,uptime=now) {
  const covered=(t:number,h:number)=>t>=s.temperature_range[0]&&t<=s.temperature_range[1]&&h>=s.humidity_range[0]&&h<=s.humidity_range[1]
  const reset=(status:string)=>{
    Object.assign(st,gasState(),{used:st.used})
    return {residual:null,z:null,ewma:0,positive:0,alert:false,status}
  }
  if(uptime<s.warm_ms)return reset('WARMING_UP')
  if(!a || a.model_sig!==signature(s)||a.r0===null||a.r0<=0||a.x0===null||a.t0===null||a.h0===null||!covered(a.t0,a.h0))return reset('BASELINE_REQUIRED')
  if(!rs||rs<=0||age>s.adc_age_limit_ms||seq===st.used)return reset('ADC_INVALID_OR_STALE')
  st.used=seq
  if(!covered(t,h))return reset('OUTSIDE_PROVISIONAL_COVERAGE')
  if(st.last && now-st.last>s.gap_ms)reset('gap')
  const poly=(temp:number,rh:number)=>{
    const x=(temp-s.temperature_center_scale[0])/s.temperature_center_scale[1],y=(rh-s.humidity_center_scale[0])/s.humidity_center_scale[1]
    const [a,b,c,d,e]=s.beta
    return a*x+b*y+c*x*x+d*y*y+e*x*y
  }
  const residual=Math.log(a.r0/rs)-a.x0-(poly(t,h)-poly(a.t0,a.h0))
  const z=(residual-s.residual_median)/s.residual_scale
  if(!Number.isFinite(z))return reset('INVALID_SCORE')
  st.ewma=s.alpha*Math.max(0,z)+(1-s.alpha)*st.ewma
  st.votes.push(st.ewma>s.limit)
  if(st.votes.length>s.window) st.votes.shift()
  const positive=st.votes.filter(Boolean).length, alert=st.votes.length===s.window&&positive>=s.confirmation
  st.last=now
  return {residual,z,ewma:st.ewma,positive,alert,status:st.votes.length<s.window?'VOTE_WARMUP':alert?'UNUSUAL_RESPONSE':'NO_CONFIRMED_RESPONSE'}
}
export const dustState=()=>({values:[] as number[],last:null as number|null,since:null as number|null})
export function dustStep(st:ReturnType<typeof dustState>,t:number,on:number|null,valid:boolean,s=sharp){
  if(!valid||on===null||st.last!==null&&t-st.last>s.reset_gap_ms)Object.assign(st,dustState())
  if(!valid||on===null)return {filtered:null,z:null,history:0,ready:false,high:false,status:'INVALID_OR_STALE'}
  st.last=t;st.values.push(on)
  if(st.values.length>s.median_window)st.values.shift()
  const filtered=median(st.values),ready=st.values.length===s.median_window
  st.since=ready&&filtered>=s.high_mv?(st.since??t):null
  const high=st.since!==null&&t-st.since>=s.persistent_high_ms
  return {filtered,z:(filtered-s.baseline_mv)/s.robust_sd_mv,history:st.values.length,ready,high,status:!ready?'FILTER_WARMUP':high?'HIGH_PERSISTENT':filtered>=s.high_mv?'HIGH_PENDING':filtered>=s.elevated_mv?'ELEVATED':filtered<s.low_mv?'LOW_RESPONSE':'BASELINE_RANGE'}
}
export function predict(points:Point[],occ:ReturnType<typeof occupancyStep>,s=forecast){
  const last=points.at(-1)!,slopes=[]
  if(points.length>=61)for(let i=0;i<points.length;i++)for(const b of points.slice(i+1))slopes.push((b.y-points[i].y)/(b.t-points[i].t))
  return {persistence:last.y,linear:occ.rate===null?null:Math.max(0,occ.mean+s.horizon_minutes*occ.rate),
    robust:slopes.length?last.y+median(slopes)*60000*s.horizon_minutes:null}
}

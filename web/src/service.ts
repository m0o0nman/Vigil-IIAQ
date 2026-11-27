import {randomUUID} from 'node:crypto'
import {approved,type Specs} from './models'
import {decision,initial,metrics,process,type Result,type State,type Mode} from './engine'
import {check,elapsed,Failure,type Batch} from './protocol'
import {blank,type Store,type Tx,type Projection} from './store'
const viewPath='system/projection'
export const modelNames=Object.keys(approved) as (keyof Specs)[]
type Version={approved:boolean,spec:Specs[keyof Specs]}
async function load(tx:Tx){
  const specs={...approved}, ids=[]
  for(const name of modelNames){
    const path='models/'+name
    const pointer=await tx.read<{active:string}>(path)
    const id=pointer?.active??'v0'
    const vpath=path+'/versions/'+id
    const version=await tx.read<Version>(vpath)
    if(!pointer&&!version){tx.put(path,{active:id});tx.put(vpath,{approved:true,spec:approved[name]})}
    else if(!version?.approved||!pointer)throw new Failure(503,'Model configuration incomplete')
    else Object.assign(specs,{[name]:version.spec})
    ids.push(name+'='+id)
  }
  return {specs,versions:ids.join(';')}
}
type Session={state:State,retired:boolean,seenAt:number}
export async function ingest(store:Store,b:Batch,now=Date.now()){
  const started=Date.now()
  const committed=await store.atomic(async tx=>{
    const view=await tx.read<Projection>(viewPath)??blank()
    const path='sessions/'+b.boot_id
    const prior=await tx.read<Session>(path)
    const session=prior??{state:initial(),retired:false,seenAt:now}
    const s=session.state, last=b.records.at(-1)!
    let latest:Result|null=null
    // Every write below shares this transaction, including history and the projection outbox.
    if(last.seq>s.seq){
      const {specs,versions}=await load(tx)
      const minutes=new Map<number,Record<string,Result>>()
      for(const r of b.records){
        if(r.seq<=s.seq)continue
        latest=process(s,r,b,versions,specs)
        const minute=Math.floor(s.time/60000)
        if(!minutes.has(minute))minutes.set(minute,{})
        minutes.get(minute)![String(r.seq)]=latest
      }
      for(const [minute,rows] of minutes)tx.put(path+'/minutes/'+String(minute),{minute,rows},true)
      s.drops=Math.max(s.drops,b.dropped_total)
      const offset=now-s.time
      s.offset=Math.min(s.offset??offset,offset)
      // A different boot must show forward progress on separate requests.
      // Known retired boots can finish history but never become live again.
      const canPromote=!view.boot || view.boot===b.boot_id ||
        (!!prior && !session.retired && session.seenAt>=view.observed && now-view.observed>15000)
      const fresh=b.command_eligible && offset-s.offset<=15000 && !session.retired && canPromote
      if(fresh && latest){
        if(view.boot!==b.boot_id){
          if(view.boot){
            const oldPath='sessions/'+view.boot
            const old=await tx.read<Session>(oldPath)
            if(old)tx.put(oldPath,{...old,retired:true})
          }
          view.buffer={};view.boot=b.boot_id
        }
        view.latest=latest;view.observed=now;view.drops=s.drops;view.gaps=s.gaps
        for(const rows of minutes.values())for(const result of Object.values(rows)){
          view.buffer[String(result.sample.seq)]={t:result.capture_ms,ppm:result.sample.scd40.control_fresh?result.sample.scd40.co2_ppm:null,fan:result.sample.fan_on}
        }
        for(const [key,v] of Object.entries(view.buffer))if(s.time-v.t>300000)delete view.buffer[key]
        view.reason=decision(view.command,latest,now,true).reason
        view.revision++;tx.put(viewPath,view)
      }
      tx.put(path,session)
      // Metrics include signed prediction-minus-actual bias and exact-target matches only.
      const minute=Math.floor(s.time/60000)
      tx.put(path+'/minutes/'+minute,{metrics:metrics(s),missed:s.missed},true)
      const eligible=!!prior && fresh && latest!==null && elapsed(last.uptime_ms,last.scd40.at_ms)+Math.max(0,offset-s.offset)<=15000
      return {view,eligible}
    }
    return {view,eligible:false}
  })
  const revision=await store.publish(committed.view)
  const delay=Math.max(0,Date.now()-started)
  const {mode,fan_cmd,fan_seconds}=decision(committed.view.command,committed.view.latest,
    now+delay,committed.eligible && revision===committed.view.revision && delay+elapsed(b.records.at(-1)!.uptime_ms,b.records.at(-1)!.scd40.at_ms)<=15000)
  return {boot_id:b.boot_id,ack_seq:b.records.at(-1)!.seq,mode,fan_cmd,fan_seconds}
}
export async function ownerChange(store:Store, action:string,input:Record<string,unknown>,now=Date.now()){
  const id=randomUUID()
  const {view,result}=await store.atomic(async tx=>{
    const view=await tx.read<Projection>(viewPath)??blank()
    let result:object={}
    if(action==='status')return {view,result:{session:view.calibration,status:view.calibration?'collecting':'idle'}}
    if(action==='command'){
      check(['auto','off','freshen'].includes(String(input.mode)),'Invalid mode')
      const mode=input.mode as Mode
      view.command={mode,expires:mode==='freshen'?now+10000:0}
      result=view.command
    }else if(action==='start'){
      if(view.calibration)throw new Failure(409,'Calibration already open')
      check(['mq135','sharp','occupancy'].includes(String(input.sensor)),'Invalid sensor')
      view.calibration=id;result={session:id,status:'collecting'}
      tx.put('calibrations/'+id,{sensor:input.sensor,status:'collecting',started:now})
    }else if(action==='abort'){
      check(view.calibration && input.session===view.calibration,'Session mismatch')
      tx.put('calibrations/'+view.calibration,{status:'aborted',ended:now},true)
      view.calibration=null;result={status:'aborted'}
    }else if(action==='rollback'){
      check(modelNames.some(m=>m===input.model)&&typeof input.version==='string'&&/^[\w-]{1,64}$/.test(input.version),'Invalid version')
      const path='models/'+input.model
      const v=await tx.read<Version>(path+'/versions/'+input.version)
      if(!v?.approved)throw new Failure(404,'Approved version unavailable')
      tx.put(path,{active:input.version});result={active:input.version}
      view.latest=null;view.buffer={};view.reason='model_changed'
    }else throw new Failure(404,'Unknown action')
    if(action==='command')view.reason=decision(view.command,view.latest,now,now-view.observed<=15000).reason
    view.revision++;tx.put(viewPath,view)
    return {view,result}
  })
  await store.publish(view)
  return result
}

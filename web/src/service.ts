import {isDeepStrictEqual} from 'node:util'
import {type Sensor} from './calibration'
import {collect,save,summary} from './session'
import {newRun,reject,type Run} from './quality'
import {allowed,savedAnchor,type Version} from './versions'
import type {Anchor} from './models'
import {createHash,randomUUID} from 'node:crypto'
import {approved,type Specs} from './models'
import {decision,initial,metrics,process,type Result,type State,type Mode} from './engine'
import {check,elapsed,Failure,type Batch} from './protocol'
import {blank,type Store,type Tx,type Projection} from './store'
const viewPath='system/projection'
export const modelNames=Object.keys(approved) as (keyof Specs)[]

async function load(tx:Tx){
  const specs={...approved}, ids=[]
  let anchor:Anchor|null=null
  for(const name of modelNames){
    const path='models/'+name
    const pointer=await tx.read<{active:string}>(path)
    const id=pointer?.active??'v0'
    const vpath=path+'/versions/'+id
    const version=await tx.read<Version>(vpath)
    if(!pointer&&!version){tx.put(path,{active:id});tx.put(vpath,{approved:true,spec:approved[name]})}
    else if(!pointer||!allowed(name,version,id))throw new Failure(503,'Model configuration incomplete')
    else {Object.assign(specs,{[name]:version!.spec});if(name==='mq135')anchor=savedAnchor(version)}
    ids.push(name+'='+id)
  }
  return {specs,versions:ids.join(';'),anchor}
}
export type Minute={minute:number,rows:Record<string,Result>,metrics:ReturnType<typeof metrics>,missed:number}
export type Session={state:State,retired:boolean,seenAt:number,open:Minute|null}
export type Control={lastCalibration?:string,view:Projection,active:Session|null,bundle:Awaited<ReturnType<typeof load>>|null}
const emptyControl=():Control=>({view:blank(),active:null,bundle:null})
function seal(tx:Tx,path:string,session:Session){
  if(session.open)tx.put(path+'/minutes/'+session.open.minute,session.open,true)
  session.open=null
}
function storeControl(tx:Tx,c:Control){
  if(Buffer.byteLength(JSON.stringify(c))>750000)throw new Failure(413,'Working state exceeds storage budget')
  tx.put(viewPath,c)
}
export async function ingest(store:Store,b:Batch,now=Date.now()){
  const started=Date.now()
  const committed=await store.atomic(async tx=>{
    const control=await tx.read<Control>(viewPath)??emptyControl()
    const view=control.view
    if(view.command.mode==='freshen' && view.command.expires<=now){
      view.command={mode:'off',expires:0};view.reason='freshen_expired';view.revision++
      storeControl(tx,control)
    }
    const path='sessions/'+b.boot_id
    const prior=view.boot===b.boot_id?control.active:await tx.read<Session>(path)
    const session=prior??{state:initial(),retired:false,seenAt:now,open:null}
    const s=session.state, last=b.records.at(-1)!
    for(const r of b.records){
      if(r.seq>s.seq)break
      const minute=Math.floor((s.time-elapsed(s.raw,r.uptime_ms))/60000)
      const archived=session.open?.minute===minute?session.open:await tx.read<Minute>(path+'/minutes/'+minute)
      if(!isDeepStrictEqual(archived?.rows[String(r.seq)]?.sample,r))
        throw new Failure(409,'Historical sequence missing or conflicting')
    }
    let latest:Result|null=null
    // Every write below shares this transaction, including history and the projection outbox.
    if(last.seq>s.seq){
      if(b.dropped_total<s.drops)throw new Failure(409,'Overflow counter regressed')
      const {specs,versions,anchor}=control.bundle??=await load(tx)
      const accepted:Result[]=[]
      for(const r of b.records){
        if(r.seq<=s.seq)continue
        latest=process(s,r,b,versions,specs,anchor)
        const minute=Math.floor(s.time/60000)
        if(session.open?.minute!==minute){
          seal(tx,path,session)
          session.open={minute,rows:{},metrics:metrics(s),missed:s.missed}
        }
        session.open.rows[String(r.seq)]=latest
        session.open.metrics=metrics(s)
        session.open.missed=s.missed
        accepted.push(latest)
      }
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
            const old=control.active
            if(old){seal(tx,oldPath,old);tx.put(oldPath,{...old,retired:true})}
          }
          view.buffer={};view.boot=b.boot_id
        }
        view.latest=latest;view.observed=s.time+s.offset;view.drops=s.drops;view.gaps=s.gaps
        for(const result of accepted){
          view.buffer[String(result.sample.seq)]={t:result.capture_ms,ppm:result.sample.scd40.control_fresh?result.sample.scd40.co2_ppm:null,fan:result.sample.fan_on}
        }
        for(const [key,v] of Object.entries(view.buffer))if(s.time-v.t>300000)delete view.buffer[key]
        view.reason=decision(view.command,latest,now,true).reason
        view.revision++
      }
      let activated=false
      if(view.calibration && !session.retired){
        activated=await collect(tx,control,b.boot_id,accepted,fresh, s.offset,now,specs,versions,anchor??b.legacy_mq_reference)
        if(activated){s.version='';view.latest=null;view.buffer={};view.reason='model_changed'}
        if(view.boot!==b.boot_id)storeControl(tx,control)
      }
      session.seenAt=now
      if(view.boot===b.boot_id){
        control.active=session
        storeControl(tx,control)
      }else{
        if(session.retired)seal(tx,path,session)
        tx.put(path,session)
      }
      const deadline=now+15000-elapsed(last.uptime_ms,last.scd40.at_ms)-Math.max(0,offset-s.offset)
      return {view,eligible:!activated && !!prior && fresh && latest!==null,deadline}
    }
    return {view,eligible:false,deadline:0}
  })
  const revision=await store.publish(committed.view)
  const delay=Math.max(0,Date.now()-started)
  const {mode,fan_cmd,fan_seconds}=decision(committed.view.command,committed.view.latest,
    now+delay,committed.eligible && revision===committed.view.revision && now+delay<=committed.deadline)
  return {boot_id:b.boot_id,ack_seq:b.records.at(-1)!.seq,mode,fan_cmd,fan_seconds}
}
export async function ownerChange(store:Store, action:string,input:Record<string,unknown>,now=Date.now(),key:string=randomUUID()){
  const id=randomUUID()
  const {view,result}=await store.atomic(async tx=>{
    const control=await tx.read<Control>(viewPath)??emptyControl()
    const view=control.view
    let result:object={}
    const op='ownerOperations/'+createHash('sha256').update(key).digest('hex')
    const fingerprint=JSON.stringify([action,Object.keys(input).sort().map(k=>[k,input[k]])])
    if(action!=='status'){
      const prior=await tx.read<{fingerprint:string,result:object}>(op)
      if(prior){
        if(prior.fingerprint!==fingerprint)throw new Failure(409,'Idempotency key already used')
        return {view,result:prior.result}
      }
    }
    if(action==='status'){
      if(input.session!==undefined)check(typeof input.session==='string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(input.session),'Invalid session')
      const session=input.session as string|undefined ?? view.calibration??control.lastCalibration
      if(!session)return {view,result:{session:null,status:'idle'}}
      const meta=await tx.read<{run?:Run,status:string} >('calibrations/'+session)
      if(!meta)throw new Failure(404,'Unknown session')
      if(!meta.run)return {view,result:{session,status:meta.status}}

      const run=meta.run
      if(view.calibration===session && now-run.lastReceipt>15000){
        reject(run,'Connection interrupted or no telemetry received');save(tx,control,run,now);storeControl(tx,control)
      }
      return {view,result:summary(run)}
    }
    if(action==='command'){
      check(typeof input.mode==='string'&&['auto','off','freshen'].includes(input.mode),'Invalid mode')
      const mode=input.mode as Mode
      view.command={mode,expires:mode==='freshen'?now+10000:0}
      result=view.command
    }else if(action==='start'){
      if(view.calibration)throw new Failure(409,'Calibration already open')
      check(typeof input.sensor==='string'&&['mq135','sharp','occupancy'].includes(input.sensor),'Invalid sensor')
      const sensor=input.sensor as Sensor
      const bundle=control.bundle??=await load(tx)
      const source=bundle.versions.split(';').find(v=>v.startsWith(sensor+'='))!.slice(sensor.length+1)
      const run=newRun(id,sensor,now,view.boot,source,input.conditions_confirmed===true)
      view.calibration=id;save(tx,control,run,now);result=summary(run)
    }else if(action==='abort'){
      check(view.calibration && input.session===view.calibration,'Session mismatch')
      const meta=await tx.read<{run?:Run}>('calibrations/'+view.calibration)
      if(meta?.run){meta.run.stage='aborted';meta.run.reason='Owner aborted session';save(tx,control,meta.run,now)}
      else tx.put('calibrations/'+view.calibration,{status:'aborted',ended:now},true)
      view.calibration=null;result={status:'aborted'}
    }else if(action==='rollback'){
      check(modelNames.some(m=>m===input.model)&&typeof input.version==='string'&&/^[\w-]{1,64}$/.test(input.version),'Invalid version')
      const path='models/'+input.model
      const v=await tx.read<Version>(path+'/versions/'+input.version)
      if(!allowed(input.model as keyof Specs,v,input.version))throw new Failure(404,'Approved version unavailable')
      tx.put(path,{active:input.version});result={active:input.version}
      control.bundle=null
      if(control.active)control.active.state.version=''
      view.latest=null;view.buffer={};view.reason='model_changed'
    }else throw new Failure(404,'Unknown action')
    if(action==='command')view.reason=decision(view.command,view.latest,now,now-view.observed<=15000).reason
    tx.put(op,{fingerprint,result,created:now})
    view.revision++;storeControl(tx,control)
    return {view,result}
  })
  await store.publish(view)
  return result
}

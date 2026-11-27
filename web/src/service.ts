import {isDeepStrictEqual} from 'node:util'
import {calibrationRow,columns,type Sensor} from './calibration'
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
    else if(!version?.approved||!pointer||!isDeepStrictEqual(version.spec,approved[name]))throw new Failure(503,'Model configuration incomplete')
    else Object.assign(specs,{[name]:version.spec})
    ids.push(name+'='+id)
  }
  return {specs,versions:ids.join(';')}
}
export type Minute={minute:number,rows:Record<string,Result>,metrics:ReturnType<typeof metrics>,missed:number}
export type Session={state:State,retired:boolean,seenAt:number,open:Minute|null}
export type Control={view:Projection,active:Session|null,bundle:Awaited<ReturnType<typeof load>>|null}
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
      const {specs,versions}=control.bundle??=await load(tx)
      const accepted:Result[]=[]
      for(const r of b.records){
        if(r.seq<=s.seq)continue
        latest=process(s,r,b,versions,specs)
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
        if(view.calibration){
          const id=view.calibration, meta=await tx.read<{sensor:Sensor,started:number}>('calibrations/'+id)
          if(!meta)throw new Failure(503,'Calibration metadata unavailable')
          const groups=new Map<number,Record<string,object>>()
          for(const row of accepted){
            if(row.capture_ms+s.offset<meta.started)continue
            const minute=Math.floor(row.capture_ms/60000)
            if(!groups.has(minute))groups.set(minute,{})
            groups.get(minute)![String(row.sample.seq)]={values:calibrationRow(meta.sensor,id,row),
              scd_valid:row.sample.scd40.valid,mq_valid:row.sample.mq135.valid,sharp_valid:row.sample.sharp.valid}
          }
          for(const [minute,rows] of groups)tx.put('calibrations/'+id+'/minutes/'+b.boot_id+'_'+minute,{boot:b.boot_id,minute,rows},true)
        }
        view.reason=decision(view.command,latest,now,true).reason
        view.revision++
      }
      session.seenAt=now
      if(view.boot===b.boot_id){
        control.active=session
        storeControl(tx,control)
      }else{
        if(session.retired)seal(tx,path,session)
        tx.put(path,session)
      }
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
    const control=await tx.read<Control>(viewPath)??emptyControl()
    const view=control.view
    let result:object={}
    if(action==='status')return {view,result:{session:view.calibration,status:view.calibration?'collecting':'idle'}}
    if(action==='command'){
      check(typeof input.mode==='string'&&['auto','off','freshen'].includes(input.mode),'Invalid mode')
      const mode=input.mode as Mode
      view.command={mode,expires:mode==='freshen'?now+10000:0}
      result=view.command
    }else if(action==='start'){
      if(view.calibration)throw new Failure(409,'Calibration already open')
      check(typeof input.sensor==='string'&&['mq135','sharp','occupancy'].includes(input.sensor),'Invalid sensor')
      view.calibration=id;result={session:id,status:'collecting'}
      tx.put('calibrations/'+id,{sensor:input.sensor,columns:columns[input.sensor as Sensor].split(','),status:'collecting',started:now})
    }else if(action==='abort'){
      check(view.calibration && input.session===view.calibration,'Session mismatch')
      tx.put('calibrations/'+view.calibration,{status:'aborted',ended:now},true)
      view.calibration=null;result={status:'aborted'}
    }else if(action==='rollback'){
      check(modelNames.some(m=>m===input.model)&&typeof input.version==='string'&&/^[\w-]{1,64}$/.test(input.version),'Invalid version')
      const path='models/'+input.model
      const v=await tx.read<Version>(path+'/versions/'+input.version)
      if(!v?.approved||!isDeepStrictEqual(v.spec,approved[input.model as keyof Specs]))throw new Failure(404,'Approved version unavailable')
      tx.put(path,{active:input.version});result={active:input.version}
      control.bundle=null
      view.latest=null;view.buffer={};view.reason='model_changed'
    }else throw new Failure(404,'Unknown action')
    if(action==='command')view.reason=decision(view.command,view.latest,now,now-view.observed<=15000).reason
    view.revision++;storeControl(tx,control)
    return {view,result}
  })
  await store.publish(view)
  return result
}

import {columns,calibrationRow} from './calibration'
import {observe,reject,type Run} from './quality'
import {versionFor} from './versions'
import type {Result} from './engine'
import type {Tx} from './store'
import type {Control} from './service'
import type {Anchor,Specs} from './models'

export function summary(run:Run){
  return {session:run.id,sensor:run.sensor,status:run.stage,reason:run.reason,source:run.source,
    observations:run.observations,window_count:run.count,distinct_scd:run.co2.length,
    window_elapsed_ms:run.windowStart===null?0:run.last!-run.windowStart,window_required_ms:60000,
    started:run.started,ended:run.ended,room_confirmed:run.confirmed,gates:run.gates,
    comparison:run.comparison,warnings:run.warnings,candidate:run.candidate,active_version_at_completion:run.stage==='passed'?run.id:null}
}
export function save(tx:Tx,control:Control,run:Run,now:number){
  if(['passed','failed','aborted'].includes(run.stage)){
    run.ended=now
    control.view.calibration=null
    control.lastCalibration=run.id
    control.view.revision++
  }
  tx.put('calibrations/'+run.id,{sensor:run.sensor,started:run.started,columns:columns[run.sensor].split(','),
    status:run.stage,run},true)
}
export async function collect(tx:Tx,control:Control,boot:string,rows:Result[],fresh:boolean,offset:number,
  now:number,specs:Specs,versions:string,anchor:Anchor|null){
  const id=control.view.calibration!
  const meta=await tx.read<{run?:Run}>('calibrations/'+id)
  if(!meta?.run){
    tx.put('calibrations/'+id,{status:'failed',reason:'Restart legacy collection with Phase 4 gates'},true)
    control.view.calibration=null;control.lastCalibration=id;control.view.revision++
    return false
  }
  const run=meta.run
  if(run.boot && run.boot!==boot)reject(run,'Device rebooted during calibration')
  else if(!fresh || now-run.lastReceipt>15000)reject(run,'Connection interrupted or replayed observations')
  else if(!versions.split(';').includes(run.sensor+'='+run.source))reject(run,'Source model version changed')
  const groups=new Map<number,Record<string,object>>()
  run.lastReceipt=now;run.boot??=boot
  for(const row of rows){
    if(run.stage!=='warmup' && run.stage!=='measuring')break
    if(row.capture_ms+offset<run.started)continue
    const minute=Math.floor(row.capture_ms/60000)
    if(!groups.has(minute))groups.set(minute,{})
    groups.get(minute)![String(row.sample.seq)]={values:calibrationRow(run.sensor,id,row,offset,run.started),
      capture_ms:row.capture_ms,scd_valid:row.sample.scd40.valid,mq_valid:row.sample.mq135.valid,sharp_valid:row.sample.sharp.valid}
    observe(run,row,specs,anchor)
  }
  for(const [minute,records] of groups)tx.put('calibrations/'+id+'/minutes/'+boot+'_'+minute,{boot,minute,rows:records},true)
  if(run.stage==='passed'){
    const model='models/'+run.sensor
    const pointer=await tx.read<{active:string}>(model)
    if(pointer?.active!==run.source)reject(run,'Source model version changed')
    else {
      tx.put(model+'/versions/'+id,versionFor(run,now))
      tx.put(model,{active:id})
      control.bundle=null
    }
  }
  save(tx,control,run,now)
  return run.stage==='passed'
}

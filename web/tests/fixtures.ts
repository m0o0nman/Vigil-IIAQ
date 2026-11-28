import {readFileSync} from 'node:fs'
import {type Store,type Tx,type Projection} from '../src/store'
import {parseBatch,type Batch} from '../src/protocol'

function mergeMaps(old:object,updates:object):object {
  const out:Record<string,unknown>={...old}
  for(const [key,value] of Object.entries(updates)){
    const prior=out[key]
    out[key]=prior && typeof prior==='object' && !Array.isArray(prior) && value && typeof value==='object' &&
      !Array.isArray(value) && Object.keys(value).length ? mergeMaps(prior,value):value
  }
  return out
}

// Serialized, copy-on-commit Firestore substitute; each read returns detached JSON.
export class Memory implements Store{
  docs:Record<string,object>={}
  view:Projection|null=null
  queue:Promise<unknown>=Promise.resolve()
  failCommit=false
  failMirror=false
  atomic<T>(fn:(tx:Tx)=>Promise<T>):Promise<T>{
    const result=this.queue.then(async()=>{
      const docs=structuredClone(this.docs)
      const result=await fn({async read<T>(p:string){return structuredClone(docs[p]??null) as T|null},
        put(p,v,merge=false){docs[p]=structuredClone(merge?mergeMaps(docs[p]??{},v):v)}})
      if(this.failCommit)throw Error('injected commit failure')
      this.docs=docs;return result
    })
    this.queue=result.catch(()=>{})
    return result
  }
  async publish(view:Projection){
    if(this.failMirror)throw Error('injected projection failure')
    if(!this.view||view.revision>this.view.revision)this.view=structuredClone(view)
    return this.view.revision
  }
}
const example:Batch=JSON.parse(readFileSync('../firmware/README.md','utf8').replace(/\r\n/g, '\n').split('```json\n')[1].split('\n```')[0])
export function batch(seq=1,t=seq*1000):Batch{
  const b=structuredClone(example),r=b.records[0]
  Object.assign(r,{seq,uptime_ms:t})
  Object.assign(r.sharp,{seq,at_ms:t})
  Object.assign(r.scd40,{at_ms:t,co2_ppm:600})
  for(const mq of [r.mq135,r.mq_at_scd])Object.assign(mq,{seq,at_ms:t})
  return parseBatch(b)
}

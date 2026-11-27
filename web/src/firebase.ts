import {applicationDefault,cert,getApps,initializeApp} from 'firebase-admin/app'
import {getAuth} from 'firebase-admin/auth'
import {getFirestore} from 'firebase-admin/firestore'
import {getDatabase} from 'firebase-admin/database'
import {Failure} from './protocol'
import type {Store,Tx,Projection} from './store'
export function app(){
  if(!process.env.FIREBASE_DATABASE_URL)throw new Failure(503,'Database configuration unavailable')
  return getApps()[0]??initializeApp({databaseURL:process.env.FIREBASE_DATABASE_URL,
    credential:process.env.FIREBASE_SERVICE_ACCOUNT_JSON?cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)):applicationDefault()})
}
export async function verify(token:string){return (await getAuth(app()).verifyIdToken(token,true)).uid}
export const firebaseStore:Store={
  async atomic(work){
    const db=getFirestore(app())
    return db.runTransaction(async transaction=>{
      const writes:(()=>void)[]=[]
      const tx:Tx={
        async read<T>(path:string){const doc=await transaction.get(db.doc(path));return doc.exists?doc.data() as T:null},
        put(path,value,merge=false){writes.push(()=>transaction.set(db.doc(path),value,{merge}))}
      }
      const result=await work(tx)
      for(const write of writes)write()
      return result
    })
  },
  async publish(v:Projection){
    if(!v.revision)return 0
    const ref=getDatabase(app()).ref()
    const result=await ref.transaction(current=>{
      if((current?.revision??0)>=v.revision)return
      return {...current,revision:v.revision,live:{latest:v.latest?{...v.latest,boot_id:v.boot,received_at:v.observed,
        dropped_total:v.drops,missing_records:v.gaps,decision_reason:v.reason}:null},
        state:{mode:v.calibration?'calibrating':v.command.mode,session:v.calibration},
        buffer:v.buffer,command:v.command,access:{owner:process.env.VIGIL_OWNER_UID}}
    },undefined,false)
    return Number(result.snapshot.child('revision').val())
  }
}
export async function* history(session:string){
  const db=getFirestore(app()),ref=db.collection('sessions').doc(session)
  if(!(await ref.get()).exists)throw new Failure(404,'Unknown session')
  const query=ref.collection('minutes').orderBy('minute').limit(16)
  let page=await query.get()
  while(!page.empty){
    for(const doc of page.docs){
      const data=doc.data()
      const rows=Object.values(data.rows??{}) as import('./engine').Result[]
      for(const row of rows.sort((a,b)=>a.sample.seq-b.sample.seq))yield row
    }
    page=await query.startAfter(page.docs.at(-1)!).get()
  }
}

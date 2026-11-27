import {createHash,timingSafeEqual} from 'node:crypto'
import {firebaseStore,verify,history,calibrationCsv} from './firebase'
import {telemetryColumns,telemetryCells,csvLine} from './export'
import {ingest,ownerChange} from './service'
import {check,Failure,parseBatch} from './protocol'
import type {Store} from './store'
const headers={'Cache-Control':'no-store'}
export function json(data:unknown,status=200){
  const body=JSON.stringify(data)
  return new Response(body,{status,headers:{...headers,'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(body))}})
}
function failed(e:unknown){return e instanceof Failure?json({error:e.message},e.status):json({error:'Service unavailable'},503)}
async function body(r:Request){
  if(!r.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new Failure(415,'Expected JSON')
  const reader=r.body?.getReader();check(reader)
  const chunks:Uint8Array[]=[];let n=0
  for(;;){const {done,value}=await reader.read();if(done)break
    n+=value.length;if(n>32768){await reader.cancel();throw new Failure(413,'Request too large')}chunks.push(value)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw new Failure(400,'Invalid JSON')}
}
export async function owner(r:Request,auth=verify){
  const uid=process.env.VIGIL_OWNER_UID
  if(!uid)throw new Failure(503,'Owner configuration unavailable')
  const token=r.headers.get('authorization')?.match(/^Bearer (\S+)$/)?.[1]
  if(!token)throw new Failure(401,'Authentication required')
  let actual:string
  try{actual=await auth(token)}catch{throw new Failure(401,'Invalid identity')}
  if(actual!==uid)throw new Failure(403,'Owner required')
}
export async function ingestRoute(r:Request,store:Store=firebaseStore){
  try{
    const secret=process.env.VIGIL_DEVICE_SECRET
    if(!secret||!process.env.VIGIL_OWNER_UID)throw new Failure(503,'Device configuration unavailable')
    const hash=(v:string)=>createHash('sha256').update(v).digest()
    if(!timingSafeEqual(hash(secret),hash(r.headers.get('x-device-secret')??'')))throw new Failure(401,'Invalid device identity')
    return json(await ingest(store,parseBatch(await body(r))))
  }catch(e){return failed(e)}
}
export async function ownerRoute(r:Request,action:string,store:Store=firebaseStore,auth=verify){
  try{
    await owner(r,auth)
    const data=action==='status'?{}:await body(r)
    check(data && typeof data==='object' && !Array.isArray(data),'Expected object')
    return json(await ownerChange(store,action,data))
  }catch(e){return failed(e)}
}
export async function exportRoute(r:Request,session:string){
  try{
    await owner(r)
    const boot=/^[0-9a-f]{32}$/.test(session)
    check(boot||/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(session),'Invalid session')
    async function* telemetry(){
      const data=history(session)
      try{
        const first=await data.next()
        yield telemetryColumns
        if(!first.done)yield telemetryCells(first.value)
        for await(const row of data)yield telemetryCells(row)
      }finally{await data.return(undefined)}
    }
    const iterator=boot?telemetry():calibrationCsv(session)
    const first=await iterator.next()
    const stream=new ReadableStream({
      start(c){if(!first.done)c.enqueue(Buffer.from(csvLine(first.value)))},
      async pull(c){const next=await iterator.next();if(next.done)c.close();else c.enqueue(Buffer.from(csvLine(next.value)))},
      async cancel(){await iterator.return(undefined)}
    })
    return new Response(stream,{headers:{...headers,'Content-Type':'text/csv','Content-Disposition':`attachment; filename="telemetry-${session}.csv"`}})
  }catch(e){return failed(e)}
}

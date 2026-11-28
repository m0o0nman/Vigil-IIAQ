'use client'

import { useEffect, useRef, useState } from 'react'
import { useVigil } from './live'
import { Icon } from './icon'

export function useRead<T>(path: string | null) {
  const { api } = useVigil()
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{path:string,value:T|null,error:string}|null>(null)
  useEffect(() => {
    if (!path) return
    let active=true
    api<T>(path).then(value => {
      if(active)setResult({path,value,error:''})
    }, () => {
      if(active)setResult({path,value:null,error:'The service could not load this information.'})
    })
    return ()=>{active=false}
  },[api,path,refresh])
  return {
    data:result?.path===path?result.value:null,
    error:result?.path===path?result.error:'',
    pending:!!path && result?.path!==path,
    reload:()=>{setResult(null);setRefresh(value=>value+1)},
  }
}

export function Download({id,label='Download CSV'}: {id:string,label?:string}) {
  const {download}=useVigil()
  const [pending,setPending]=useState(false)
  const [error,setError]=useState(false)
  return <div>
    <button className="button" disabled={pending} onClick={async()=>{
      setPending(true);setError(false)
      try{await download(id)}catch{setError(true)}finally{setPending(false)}
    }}><Icon name="download"/>{pending?'Preparing CSV…':label}</button>
    {error&&<p role="alert">CSV download failed. Try again.</p>}
  </div>
}

export function Restore({model,version,onRestored}: {model:string,version:string,onRestored:()=>void}) {
  const {api}=useVigil()
  const dialog=useRef<HTMLDialogElement>(null)
  const key=useRef('')
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  return <div>
    <button className="button" onClick={()=>{
      key.current=crypto.randomUUID()
      setError('');dialog.current?.showModal()
    }}>Restore previous calibration</button>
    <dialog ref={dialog} onCancel={event=>{if(pending)event.preventDefault()}} aria-label="Confirm calibration restore">
      <h2>Restore this version?</h2>
      <p>Activate the selected {model==='mq135'?'Fumes':model==='sharp'?'Dust':'Occupancy'} calibration.
        The live model will rebuild its measurement window.</p>
      <p className="version">{version}</p>
      <div className="actions">
        <button className="button" autoFocus disabled={pending} onClick={()=>dialog.current?.close()}>Cancel</button>
        <button className="button primary" disabled={pending} onClick={async()=>{
          setPending(true);setError('')
          try{
            await api('/api/model/rollback',{model,version},key.current)
            dialog.current?.close()
            onRestored()
          }catch{setError('The service could not confirm the restore. Retry to check the request.')}
          finally{setPending(false)}
        }}>{pending?'Restoring…':'Confirm restore'}</button>
      </div>
      {error&&<p role="alert">{error}</p>}
    </dialog>
  </div>
}

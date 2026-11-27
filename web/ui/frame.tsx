'use client'

import Link from 'next/link'
import {usePathname} from 'next/navigation'
import { useState, type FormEvent, type ReactNode } from 'react'
import { useVigil } from './live'
import { statusOf } from './state'

export function Brand() {
  return <Link href="/" className="brand" aria-label="VIGIL home">
    {/* The original transparent brand trace has an intrinsic 1706:2048 ratio. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/brand/logos/logo-forest.svg" width="32" height="38" alt="" />
    <span>VIGIL</span>
  </Link>
}

export function Orb({active=true}: {active?: boolean}) {
  return <div className={'orb-field' + (active ? '' : ' still')} aria-hidden="true">
    <div className="orbit orbit-outer" /><div className="orbit orbit-middle" /><div className="orbit orbit-inner" />
    <div className="orb-disk"><div className="orb-core"/></div>
    <i className="orbit-dot"/><i className="orbit-dot second"/>
  </div>
}

function Login() {
  const { signIn } = useVigil()
  const [pending,setPending]=useState(false)
  const [error,setError]=useState('')
  async function submit(event:FormEvent<HTMLFormElement>){
    event.preventDefault()
    const fields=new FormData(event.currentTarget)
    setPending(true);setError('')
    try { await signIn(String(fields.get('email')).trim(),String(fields.get('password'))) }
    catch { setError('Sign-in failed. Check your credentials and connection, then try again.') }
    finally { setPending(false) }
  }
  return <div className="narrow content-pad">
    <p className="eyebrow">Owner access</p><h1>Sign in to VIGIL</h1>
    <form className="form-stack" onSubmit={submit}>
      <label>Email<input name="email" type="email" autoComplete="username" required /></label>
      <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
      <button className="button primary" disabled={pending}>{pending?'Signing in…':'Sign in'}</button>
      {error && <p className="notice" role="alert">{error}</p>}
    </form>
  </div>
}

export function Frame({ children }: { children: ReactNode }) {
  const {access,latest,connected,liveReady,liveError,now,signOut,retry}=useVigil()
  const [accountError,setAccountError]=useState('')
  const location=usePathname()
  const live=statusOf(latest,now,connected)
  return <>
    <a href="#content" className="skip">Skip to content</a>
    <header className="site-header"><div className="header-inner">
      <Brand />
      {access==='owner' && <>
        <nav aria-label="Main navigation">
          {Object.entries({'/breathe':'Monitor','/details':'Details','/calibrate':'Calibrate','/settings':'Settings'}).map(([path,label])=>
            <Link key={path} href={path} aria-current={location===path?'page':undefined}>{label}</Link>
          )}
        </nav>
        <span className="connection"><i className={live.deviceLive?'online':''}/>
          {!liveReady?'Connecting…':liveError?'Live feed unavailable':live.connection}</span>
      </>}
    </div></header>
    <main id="content" className="site-main" tabIndex={-1}>
      {access==='owner' ? children : access==='signed-out' ? <Login/> :
        <div className="narrow content-pad">
          <h1>{{
            loading:'Opening VIGIL…', checking:'Checking owner access…', unauthorized:'Owner access required',
            unavailable:'VIGIL is temporarily unavailable', unconfigured:'VIGIL setup required',
          }[access]}</h1>
          {access==='unconfigured' && <p>Configure the Firebase web app to sign in and receive live observations.</p>}
          {access==='unauthorized' && <p>This account cannot access the VIGIL monitor.</p>}
          {access==='unavailable' && <button className="button" onClick={retry}>Retry</button>}
          {['unauthorized','unavailable'].includes(access) && <button className="button quiet" onClick={()=>
            void signOut().catch(()=>setAccountError('Could not sign out. Try again.'))}>Sign out</button>}
          {accountError && <p role="alert">{accountError}</p>}
        </div>
      }
    </main>
    <footer className="site-footer"><span>VIGIL</span><span>Indoor air &amp; ventilation prototype</span></footer>
  </>
}

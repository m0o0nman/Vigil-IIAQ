'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { useVigil } from './live'
import { statusOf } from './state'
import { Icon } from './icon'

const destinations = [
  { path: '/breathe', label: 'Monitor' },
  { path: '/details', label: 'Details' },
  { path: '/calibrate', label: 'Calibrate' },
  { path: '/settings', label: 'Settings' },
]

export function BrandPanel() {
  return <div className="brand-panel">
    <Image loading="eager" src="/brand/editorial/lockup.webp" width={960} height={406}
      sizes="(max-width: 700px) 85vw, 480px" alt="VIGIL. Intelligent indoor air quality monitoring system" />
  </div>
}

function Login() {
  const { signIn } = useVigil()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const fields = new FormData(event.currentTarget)
    setPending(true)
    setError('')
    try { await signIn(String(fields.get('email')).trim(), String(fields.get('password'))) }
    catch { setError('Sign-in failed. Check your credentials and connection, then try again.') }
    finally { setPending(false) }
  }
  return <div className="entry-layout">
    <div className="entry-copy">
      <p className="eyebrow"><Icon name="account" /> Owner access</p><h1>Sign in to VIGIL</h1>
      <form className="form-stack" onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="username" required /></label>
        <label>Password<input name="password" type="password" autoComplete="current-password" required /></label>
        <button className="button primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'} <Icon name="arrow"/></button>
        {error && <p className="notice" role="alert">{error}</p>}
      </form>
    </div>
    <BrandPanel />
  </div>
}

export function Frame({ children }: { children: ReactNode }) {
  const {access, latest, connected, liveReady, liveError, now, signOut, retry} = useVigil()
  const path = usePathname()
  const index = destinations.findIndex(item => item.path === path)
  const live = statusOf(latest, now, connected && !liveError && liveReady)
  const [accountError, setAccountError] = useState('')
  const leave = () => signOut().catch(() => setAccountError('Could not sign out. Try again.'))
  return <div className="shell">
    <a href="#content" className="skip">Skip to content</a>
    <header className="site-header">
      <Link href="/" className="brand" aria-label="VIGIL home" aria-current={path==='/'?'page':undefined}>
        <Image loading="eager" unoptimized src="/brand/editorial/signature.png" width={280} height={124} alt="VIGIL" />
      </Link>
      {access === 'owner' && <>
        <nav aria-label="Main navigation" className="navigation" style={{'--tab': Math.max(0, index)} as CSSProperties}>
          <span className="nav-indicator" data-visible={index >= 0} aria-hidden="true" />
          {destinations.map(item => <Link key={item.path} href={item.path}
            aria-current={path === item.path ? 'page' : undefined}>{item.label}</Link>)}
        </nav>
        <div className="header-tools">
          <span className="connection"><i className="signal" data-live={live.deviceLive} />
            {!liveReady ? 'Connecting…' : liveError ? 'Live feed unavailable' : live.connection}</span>
          <details className="account" key={path}><summary aria-label="Account menu"><Icon name="account"/></summary>
            <div><Link href="/settings">Settings</Link><button onClick={leave}>Sign out</button></div>
          </details>
        </div>
      </>}
    </header>
    {accountError && <p className="notice" role="alert">{accountError}</p>}
    <main id="content" key={path + access} tabIndex={-1}>
      {access === 'owner' ? children : access === 'signed-out' ? <Login/> :
        <div className="entry-layout"><div className="entry-copy">
          <h1>{{
            loading:'Opening VIGIL…', checking:'Checking owner access…', unauthorized:'Owner access required',
            unavailable:'VIGIL is temporarily unavailable', unconfigured:'VIGIL setup required',
          }[access]}</h1>
          {['loading','checking'].includes(access) && <div className="skeleton" aria-hidden="true" />}
          {access==='unconfigured' && <p>Configure the Firebase web app to sign in and receive live observations.</p>}
          {access==='unauthorized' && <p>This account cannot access the VIGIL monitor.</p>}
          {access==='unavailable' && <button className="button" onClick={retry}>Retry</button>}
          {['unauthorized','unavailable'].includes(access) && <button className="button" onClick={leave}>Sign out</button>}
        </div><BrandPanel/></div>
      }
    </main>
    <footer className="site-footer"><span>VIGIL</span><span>Indoor air &amp; ventilation prototype</span></footer>
  </div>
}

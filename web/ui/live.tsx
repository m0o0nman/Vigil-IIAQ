'use client'

import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react'
import { initializeApp, getApps } from 'firebase/app'
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth'
import { getDatabase, onValue, ref } from 'firebase/database'
import { type Latest, type Requested, observationTime } from './state'

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
}

export class RequestError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

async function request(user: User, url: string, body?: object, key?: string) {
  const headers: Record<string, string> = { Authorization: 'Bearer ' + await user.getIdToken() }
  if (body) {
    headers['Content-Type'] = 'application/json'
    headers['Idempotency-Key'] = key ?? crypto.randomUUID()
  }
  const response = await fetch(url, { headers, ...(body ? { method:'POST', body:JSON.stringify(body) } : {}), cache:'no-store' })
  if (!response.ok) {
    const data = await response.json().catch(() => null)
    throw new RequestError(response.status, data?.error ?? 'The service could not complete the request.')
  }
  return response
}

type Access = 'loading'|'signed-out'|'checking'|'owner'|'unauthorized'|'unavailable'|'unconfigured'
export type VigilState = {
  access: Access
  latest: Latest | null
  connected: boolean
  liveReady: boolean
  liveError: boolean
  now: number
  lastValid: number | null
  requested: Requested | null
  calibrating: string | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  retry(): void
  api<T>(path: string, body?: object, key?: string): Promise<T>
  download(id: string): Promise<void>
}

export const VigilContext = createContext<VigilState | null>(null)
export function useVigil() {
  const value = useContext(VigilContext)
  if (!value) throw new Error('VIGIL provider required')
  return value
}

export function VigilProvider({children}: {children: ReactNode}) {
  const [access, setAccess] = useState<Access>('loading')
  const [user, setUser] = useState<User | null>(null)
  const [app, setApp] = useState<ReturnType<typeof initializeApp> | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [latest, setLatest] = useState<Latest | null>(null)
  const [lastValid, setLastValid] = useState<number | null>(null)
  const [connected, setConnected] = useState(false)
  const [liveReady, setReady] = useState(false)
  const [liveError, setLiveError] = useState(false)
  const [requested, setRequested] = useState<Requested | null>(null)
  const [calibrating, setCalibrating] = useState<string | null>(null)
  const [now, setNow] = useState(0)

  useEffect(() => {
    if (!Object.values(config).every(Boolean)) { setAccess('unconfigured'); return }
    try {
      const instance = getApps()[0] ?? initializeApp(config)
      setApp(instance)
      return onAuthStateChanged(getAuth(instance), identity => {
        setLatest(null); setLastValid(null); setConnected(false); setReady(false); setLiveError(false)
        setRequested(null); setCalibrating(null); setUser(identity)
        setAccess(identity ? 'checking' : 'signed-out')
      }, () => setAccess('unavailable'))
    } catch { setAccess('unavailable') }
  }, [])

  useEffect(() => {
    if (!user) return
    let active = true
    setAccess('checking')
    request(user, '/api/calibrate/status').then(() => {
      if (active) setAccess('owner')
    }, (error: unknown) => {
      if (active) setAccess(error instanceof RequestError && [401,403].includes(error.status) ? 'unauthorized' : 'unavailable')
    })
    return () => { active = false }
  }, [user, attempt])

  useEffect(() => {
    if (access !== 'owner' || !app) return
    const db = getDatabase(app)
    const unsubscribe = [
      onValue(ref(db, '.info/connected'), snapshot => setConnected(snapshot.val() === true)),
      onValue(ref(db, 'live/latest'), snapshot => {
        const value = snapshot.val() as Latest | null
        setLatest(value); setReady(true); setLiveError(false); setNow(Date.now())
        if (value?.sample.scd40.valid && typeof value.sample.scd40.co2_ppm === 'number') {
          const timestamp = observationTime(value)
          setLastValid(previous => Math.max(previous ?? timestamp, timestamp))
        }
      }, () => { setReady(true); setLiveError(true) }),
      onValue(ref(db, 'command'), snapshot => setRequested(snapshot.val() as Requested | null), () => {}),
      onValue(ref(db, 'state'), snapshot => setCalibrating(snapshot.val()?.session ?? null), () => {}),
    ]
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    setNow(Date.now())
    return () => { unsubscribe.forEach(stop => stop()); window.clearInterval(timer) }
  }, [access, app])

  const api = useCallback(async <T,>(path: string, body?: object, key?: string): Promise<T> => {
    if (!user || access !== 'owner') throw new Error('Owner sign-in is required.')
    return await (await request(user, path, body, key)).json() as T
  }, [user, access])

  const value: VigilState = {
    access, latest, connected, liveReady, liveError, now, lastValid, requested, calibrating, api,
    async signIn(email, password) {
      if (!app) throw new Error('Firebase is unavailable.')
      await signInWithEmailAndPassword(getAuth(app), email, password)
    },
    async signOut() { if(app) await signOut(getAuth(app)) },
    retry() { setAttempt(value => value+1) },
    async download(id) {
      if (!user || access !== 'owner') throw new Error('Owner sign-in is required.')
      const response = await request(user, '/api/export/' + encodeURIComponent(id))
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = 'vigil-' + id + '.csv'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    },
  }
  return <VigilContext.Provider value={value}>{children}</VigilContext.Provider>
}

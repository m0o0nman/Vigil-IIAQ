// Read-only views over the existing Phase 3 and 4 document paths.
import { getFirestore } from 'firebase-admin/firestore'
import { app } from './firebase'
import { Failure } from './protocol'
import { metrics } from './engine'
import type { Control, Minute, Session } from './service'
import type { Run } from './quality'

export type CalibrationEntry = {
  id: string
  sensor: string
  status: string
  started: number
  source: string | null
}
export async function readCalibrations() {
  const db = getFirestore(app())
  const [list, models] = await Promise.all([
    db.collection('calibrations').orderBy('started', 'desc').limit(20).get(),
    db.collection('models').get(),
  ])
  const entries: CalibrationEntry[] = list.docs.map(doc => {
    const { sensor, status, started, run } = doc.data() as {sensor:string,status:string,started:number,run?:Run}
    return { id:doc.id,sensor,status,started,source:run?.source??null }
  })
  const active = Object.fromEntries(models.docs.map(doc => [doc.id, doc.get('active') as string]))
  return { entries, active }
}

export async function readAnalytics(boot: string) {
  const db = getFirestore(app())
  const ref = db.collection('sessions').doc(boot)
  return db.runTransaction(async transaction => {
    const current = (await transaction.get(db.doc('system/projection'))).data() as Control | undefined
    const session = current?.view.boot === boot ? current.active : (await transaction.get(ref)).data() as Session | undefined
    if (!session) throw new Failure(404, 'This device session is unavailable')
    const latestMinute = Math.floor(session.state.time / 60000)
    const query = ref.collection('minutes').where('minute', '>=', latestMinute - 59).orderBy('minute').limit(60)
    const archive = await transaction.get(query)
    const minutes = archive.docs.map(doc => doc.data() as Minute)
    if (session.open) minutes.push(session.open)
    const rows = minutes.flatMap(minute => Object.values(minute.rows))
      .filter(row => row.sample.seq <= session.state.seq)
      .sort((a, b) => a.sample.seq - b.sample.seq)
      .map(({sample, capture_ms, gap, versions, occupancy, occupancy_ready, dust, forecast}) => ({
        t: capture_ms, scd: sample.scd40.at_ms,
        co2: sample.scd40.control_fresh ? sample.scd40.co2_ppm : null,
        temperature: sample.scd40.valid ? sample.scd40.temperature_c : null,
        humidity: sample.scd40.valid ? sample.scd40.rh_pct : null,
        people: occupancy_ready ? occupancy?.estimate ?? null : null,
        dustOn: sample.sharp.valid ? sample.sharp.on_mv : null,
        dustFiltered: dust.ready ? dust.filtered : null,
        fan: sample.fan_on, fanReason: sample.fan_reason, gap, versions, forecast,
      }))
    return { rows, metrics: metrics(session.state), versions: session.state.version }
  }, {readOnly:true})
}

export type Analytics = Awaited<ReturnType<typeof readAnalytics>>
export type CalibrationArchive = Awaited<ReturnType<typeof readCalibrations>>

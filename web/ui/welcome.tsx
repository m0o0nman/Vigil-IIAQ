'use client'

import Link from 'next/link'
import { BrandPanel } from './frame'
import { useVigil } from './live'
import { Icon } from './icon'

export function Welcome() {
  const { latest, calibrating } = useVigil()
  const calibrated = latest?.versions.split(';').some(version=>!version.endsWith('=v0'))
  return <section className="entry-layout">
    <div className="entry-copy">
      <p className="eyebrow"><Icon name="home"/> Your indoor environment</p>
      <h1>Take a breath.<br/>Meet VIGIL.</h1>
      <p className="intro">Follow the air in your room, from everyday CO₂ changes to when ventilation starts.</p>
      <div className="actions">
        <Link className="button primary" href="/breathe">Breathe <Icon name="arrow"/></Link>
        <Link className="button" href="/calibrate">{calibrating?'Resume calibration':'Calibrate'}</Link>
      </div>
      <p className="support">{calibrating?'A calibration session is in progress.'
        : calibrated?'Your active calibration is available in Settings.'
        :'You can start monitoring while the sensors warm up or await calibration.'}</p>
    </div>
    <BrandPanel/>
  </section>
}

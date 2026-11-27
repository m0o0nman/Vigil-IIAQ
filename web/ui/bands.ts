// Provisional owner-approved UI labels. CO₂ 750 and 1000 ppm come from
// inputs/code/VIGIL_Phase3_Fixed.ino:25. 600 ppm is an owner UI decision.
// RH cutoffs are owner-approved interpretations of EPA indoor humidity guidance.
export const bands = {
  co2: [
    { below: 600, label: 'Fresh', key: 'fresh', description: 'CO₂ is in the lowest VIGIL monitoring band.' },
    { below: 750, label: 'OK', key: 'ok', description: 'CO₂ is below the prototype’s ventilation monitoring band.' },
    { below: 1000, label: 'Stuffy', key: 'stuffy', description: 'CO₂ is in the prototype’s ventilation monitoring band.' },
    { below: Infinity, label: 'Poor', key: 'poor', description: 'CO₂ has reached the prototype’s ventilation trigger.' },
  ],
  humidity: [
    { below: 30, label: 'Dry' },
    { below: 60, label: 'Comfortable' },
    { below: Infinity, label: 'Humid' },
  ],
} as const

export function co2Status(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0
    ? bands.co2.find(band => value < band.below) ?? null
    : null
}

export function humidityStatus(value: number | null) {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100
    ? bands.humidity.find(band => value < band.below)?.label ?? null
    : null
}

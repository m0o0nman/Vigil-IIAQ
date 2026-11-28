const paths = {
  home: 'M3 11 12 4l9 7v9h-7v-6h-4v6H3z',
  account: 'M16 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0',
  people: 'M13 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM3 20a7 7 0 0 1 14 0M16 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5',
  climate: 'M9 14V5a3 3 0 0 1 6 0v9a5 5 0 1 1-6 0Zm3-7v9m6-9h2m-2 4h2',
  air: 'M3 8h10a3 3 0 1 0-3-3M2 12h16a3 3 0 1 0-2-5M5 16h7a3 3 0 1 1-3 3',
  dust: 'M7 6h.01M16 4h.01M12 12h.01M4 16h.01M20 14h.01M15 20h.01M8 20h.01',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9m-7-13v6M8 14v6',
  fan: 'M12 10c-3-1-3-4-2-6 1-2 6-2 7 0-3 1-1 5-4 7m1 1c2-2 5-2 7 0 2 2-1 6-3 7 0-4-4-3-5-6m-1 1c0 3-2 5-5 5-3 0-5-4-4-6 3 2 5-2 8-1m3 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  arrow: 'M5 12h13m-5-5 5 5-5 5',
  download: 'M12 4v10m-4-4 4 4 4-4M5 16v4h14v-4',
  external: 'M7 17 17 7M7 7h10v10',
  refresh: 'M19 9a7.5 7.5 0 1 0 .5 5M19 4v5h-5',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <path d={paths[name]} />
  </svg>
}

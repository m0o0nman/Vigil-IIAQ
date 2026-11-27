const paths = {
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

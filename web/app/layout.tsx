import type { Metadata } from 'next'
import { Syne } from 'next/font/google'
import type { ReactNode } from 'react'
import { VigilProvider } from '../ui/live'
import { theme } from '../ui/theme'
import './style.css'

const syne = Syne({ subsets: ['latin'], weight: 'variable', display: 'swap', fallback: ['Arial', 'sans-serif'] })

export const metadata: Metadata = {
  title: { default: 'VIGIL · Indoor air', template: '%s · VIGIL' },
  description: 'Indoor air monitoring and ventilation for the VIGIL prototype.',
  icons: { icon: '/brand/logos/favicon.svg', apple: '/brand/logos/favicon-192.png' },
}

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" className={syne.className} style={theme}>
    <body><VigilProvider>{children}</VigilProvider></body>
  </html>
}

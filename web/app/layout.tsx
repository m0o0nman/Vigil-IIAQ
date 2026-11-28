import type { Metadata } from 'next'
import localFont from 'next/font/local'
import type { ReactNode } from 'react'
import { VigilProvider } from '../ui/live'
import { Frame } from '../ui/frame'
import { theme } from '../ui/theme'
import './style.css'

const syne = localFont({ src: '../public/brand/fonts/syne-regular.woff2', weight: '400', style: 'normal', display: 'swap', fallback: ['Arial', 'sans-serif'] })

export const metadata: Metadata = {
  title: { default: 'VIGIL · Indoor air', template: '%s · VIGIL' },
  description: 'Indoor air monitoring and ventilation for the VIGIL prototype.',
  icons: { icon: '/brand/editorial/icon.png', apple: '/brand/editorial/icon.png' },
}

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en" className={syne.className} style={theme}>
    <body><VigilProvider><Frame>{children}</Frame></VigilProvider></body>
  </html>
}

import colours from '../../inputs/brand/colours/colours.json'
import type { CSSProperties } from 'react'

export const theme = Object.fromEntries(Object.entries(colours).map(
  ([name, value]) => ['--' + name, value]
)) as CSSProperties

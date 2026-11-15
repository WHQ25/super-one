import type { ReactNode } from 'react'

export interface TurnSegmentProps {
  children: ReactNode
  estimate?: number
  id: string
}

/** Segments per evictable chunk: bounds observer and state overhead as well as mounted activity DOM. */
export const TURN_SEGMENT_CHUNK = 8

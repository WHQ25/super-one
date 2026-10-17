import { createContext } from 'react'
import type { MosaicNode } from './mosaic-tree'

/** Only foreground split panes share this tree; parked layouts and the mini shell do not. */
export const VisibleSessionSplitContext = createContext<MosaicNode | null>(null)

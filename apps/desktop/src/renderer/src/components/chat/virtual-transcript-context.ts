import { createContext, useContext, type RefObject } from 'react'

export interface VirtualTranscriptContextValue {
  viewportRef: RefObject<HTMLDivElement | null>
  /** Shared observers avoid one observer per markdown paragraph. */
  observeBlock: (element: HTMLElement, onVisible: (visible: boolean) => void) => () => void
  /** Restore above-viewport block geometry before its reveal is painted. */
  preserveBlockAnchor: (element: HTMLElement, placeholderHeight: number) => void
}
export const VirtualTranscriptContext = createContext<VirtualTranscriptContextValue | null>(null)
export const useVirtualTranscript = () => useContext(VirtualTranscriptContext)

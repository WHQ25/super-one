import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'
import { TranscriptStateProvider } from '@superone/ui/lib/transcript-state'
import { VirtualTranscriptContext, type VirtualTranscriptContextValue } from './virtual-transcript-context'

interface VirtualMarkdownViewportProps {
  enabled: boolean
  className?: string
  children: ReactNode
}

export function VirtualMarkdownViewport({ enabled, className, children }: VirtualMarkdownViewportProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const states = useRef(new Map<string, unknown>()).current
  const callbacks = useRef(new Map<Element, (visible: boolean) => void>()).current
  const observerRef = useRef<IntersectionObserver | null>(null)
  const active = enabled && typeof IntersectionObserver !== 'undefined'

  useLayoutEffect(() => {
    const root = viewportRef.current
    if (!active || !root) return
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          callbacks.get(entry.target)?.(entry.isIntersecting)
        }
      },
      { root, rootMargin: '600px 0px' },
    )
    observerRef.current = observer
    for (const element of callbacks.keys()) observer.observe(element)
    return () => {
      observer.disconnect()
      observerRef.current = null
    }
  }, [active, callbacks])

  const observeBlock = useCallback(
    (element: HTMLElement, onVisible: (visible: boolean) => void) => {
      callbacks.set(element, onVisible)
      observerRef.current?.observe(element)
      return () => {
        callbacks.delete(element)
        observerRef.current?.unobserve(element)
      }
    },
    [callbacks],
  )

  const preserveBlockAnchor = useCallback((element: HTMLElement, placeholderHeight: number) => {
    const root = viewportRef.current
    if (!root) return
    const delta = element.getBoundingClientRect().height - placeholderHeight
    if (Math.abs(delta) < 0.5) return
    const rootTop = root.getBoundingClientRect().top
    if (element.getBoundingClientRect().bottom < rootTop) {
      root.scrollTop += delta
    }
  }, [])

  const context = useMemo<VirtualTranscriptContextValue>(
    () => ({ viewportRef, observeBlock, preserveBlockAnchor }),
    [observeBlock, preserveBlockAnchor],
  )

  return (
    <div ref={viewportRef} className={className}>
      {active ? (
        <TranscriptStateProvider values={states} scope="preview-markdown">
          <VirtualTranscriptContext.Provider value={context}>
            {children}
          </VirtualTranscriptContext.Provider>
        </TranscriptStateProvider>
      ) : (
        children
      )}
    </div>
  )
}

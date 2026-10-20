import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import type { ProcessFold } from '@superone/shared/agent-types'

export interface TurnFoldPresenterProps {
  fold: ProcessFold
}

/** Screens below the viewport a shown fold reads ahead. Nothing reads ahead above it, so rows never land over the reader. */
const PREFETCH_SCREENS = 1
/** Input that scrolls by the reader's hand; a programmatic scroll fires none of these. */
const GESTURES = ['wheel', 'touchmove', 'keydown'] as const

function scrollRoot(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY
    if (overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay') return node
  }
  return null
}

function pageId(fold: ProcessFold): string {
  return JSON.stringify([fold.messageId, fold.key, fold.revision, fold.after ?? null])
}

/**
 * Process a transcript window has not loaded yet. It paints only when shown
 * (the turn's Detail is open, or the turn does not collapse), and then reads
 * its next page whenever it comes within a screen below the viewport: a long
 * turn loads the rows the reader reaches, a page at a time. The page joins the
 * row through the host's own message updates; `load` only settles the read.
 */

export function TranscriptFoldPresenter({ fold, load }: TurnFoldPresenterProps & { load: (fold: ProcessFold) => Promise<void> }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const page = pageId(fold)
  const [failed, setFailed] = useState<string | null>(null)
  const current = useRef({ fold, load })
  current.current = { fold, load }
  const blocked = failed === page
  /** Page a Retry click is already reading, so the effect does not read it again. */
  const reading = useRef<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    if (reading.current !== page) reading.current = null
    const element = ref.current
    if (!element || blocked || reading.current === page) return
    let active = true
    let reached = false
    // Opening Detail reads the first page. Later pages wait for the reader to
    // scroll: a view that follows its tail keeps the rest in reach on its own.
    let moved = fold.after === undefined
    const stop = () => {
      observer.disconnect()
      for (const type of GESTURES) window.removeEventListener(type, onGesture)
    }
    const read = () => {
      if (!reached || !moved) return
      stop()
      void current.current.load(current.current.fold).catch(() => { if (active) setFailed(page) })
    }
    const onGesture = () => { moved = true; read() }
    const observer = new IntersectionObserver((entries) => {
      reached = entries.some((entry) => entry.isIntersecting)
      read()
    }, { root: scrollRoot(element), rootMargin: `0px 0px ${PREFETCH_SCREENS * 100}% 0px` })
    observer.observe(element)
    if (!moved) for (const type of GESTURES) window.addEventListener(type, onGesture, { passive: true })
    return () => { active = false; stop() }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `page` covers the fold's identity and position
  }, [page, blocked])

  // Retry is the reader asking again. The click is not a scroll, so a later
  // page must not go back to waiting for one.
  const retry = useCallback(() => {
    const { fold: currentFold, load: read } = current.current
    const id = pageId(currentFold)
    reading.current = id
    setFailed(null)
    void read(currentFold).catch(() => { if (mounted.current && reading.current === id) setFailed(id) })
  }, [])
  return (
    <div ref={ref} data-testid="transcript-fold" className="my-1 flex items-center gap-1.5 text-xs text-muted-foreground">
      {blocked ? (
        <>
          <span>{t('chat.transcriptWindow.foldFailed')}</span>
          <button type="button" onClick={retry} className="font-medium text-foreground/80 underline-offset-2 hover:underline">
            {t('chat.transcriptWindow.foldRetry')}
          </button>
        </>
      ) : (
        <>
          <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
          <span role="status">{t('common.loading')}</span>
        </>
      )}
    </div>
  )
}

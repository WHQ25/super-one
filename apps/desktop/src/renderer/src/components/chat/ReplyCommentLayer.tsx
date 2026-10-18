import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type Ref, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useActiveSession, useChatStore, useSessionScope, type ReplyComment } from '@/stores/chat'
import { useIsDark } from '@/hooks/use-is-dark'
import {
  findTextRange,
  highlightBandsFromRects,
  rangeRects,
  topRightOfRects,
  type HighlightBand,
  type ViewportCorner,
} from './plan-annotation-dom'
import { stickyForComment, stickyForDraft, type StickySwatch } from './plan-sticky-palette'
import { MarkerStroke, STICKY_UI_ATTR, StickyNoteEditor, StickyPinButton, strokeSeed } from './plan-sticky-visuals'
import { onReplyCommentEditRequest, type ReplyCommentAnchor } from './reply-comment-target'

/** A selection about to be commented on: where it is, and how it quotes. */
export type ReplyCommentDraft = ReplyCommentAnchor & { quote: string }

export interface ReplyCommentLayerHandle {
  /** Turn a selection into a highlighted draft with its note open. */
  startDraft: (draft: ReplyCommentDraft) => void
}

/** An open note: a new draft, or a saved comment (`id`) being edited. */
type Note = ReplyCommentDraft & { id?: string; text: string }

type Stroke = { key: string; bands: HighlightBand[]; swatch: StickySwatch }

interface Layout {
  strokes: Stroke[]
  pins: Record<string, ViewportCorner>
  note: ViewportCorner | null
}

const PIN = 18
const NOTE_WIDTH = 202
/** The open note's rendered height (its 190px sheet plus skew and shadow). */
const NOTE_HEIGHT = 200
/** Room between the pin and a note opened below it. */
const NOTE_GAP = 14
const DRAFT_KEY = '__draft__'
const EMPTY_LAYOUT: Layout = { strokes: [], pins: {}, note: null }
const EMPTY_COMMENTS: ReplyComment[] = []

/** Search from the row the passage starts in, so earlier repeats of its text don't match. */
function locate(root: HTMLElement, anchor: ReplyCommentAnchor): Range | null {
  if (anchor.messageId === null) return findTextRange(root, anchor.anchorText)
  const row = root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(anchor.messageId)}"]`)
  // A virtualized-away row is not on the page: nothing to draw.
  return row ? findTextRange(root, anchor.anchorText, row) : null
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (/auto|scroll/.test(getComputedStyle(p).overflowY)) return p
  }
  return null
}

/**
 * Where the open note goes in layer coordinates: below its pin, or above the
 * highlight when the transcript's visible bottom (the composer's top edge)
 * would cover it and there is room above.
 */
function notePosition(pin: ViewportCorner, root: HTMLElement, origin: DOMRect): ViewportCorner {
  const left = Math.max(8, Math.min(pin.left - 12, root.clientWidth - NOTE_WIDTH - 12))
  const below = pin.top + PIN + NOTE_GAP
  const viewport = scrollParent(root)?.getBoundingClientRect()
  if (!viewport) return { top: below, left }
  const visibleTop = viewport.top - origin.top
  const visibleBottom = viewport.bottom - origin.top
  const above = pin.top - NOTE_HEIGHT
  const flip = below + NOTE_HEIGHT > visibleBottom && above >= visibleTop
  return { top: flip ? above : below, left }
}

/** A range's line boxes relative to `origin`, so they scroll with the transcript. */
function localRects(range: Range, origin: DOMRect): DOMRect[] {
  return rangeRects(range).map((r) => new DOMRect(r.left - origin.left, r.top - origin.top, r.width, r.height))
}

/**
 * Highlighter strokes, mini Post-it pins and the open note for comments on
 * the transcript — plan review's sticky notes, laid over it.
 *
 * Passages are found again as DOM `Range`s instead of being wrapped in marks:
 * the transcript is React's (and streams), so it is never rewritten. The layer
 * sits in the transcript's own coordinate space, so it scrolls with it and only
 * re-measures when content or size changes.
 */
export function ReplyCommentLayer({ rootRef, ref }: { rootRef: RefObject<HTMLElement | null>; ref: Ref<ReplyCommentLayerHandle> }) {
  const { t } = useTranslation()
  const isDark = useIsDark()
  const scope = useSessionScope()
  const comments = useActiveSession((s) => s.replyComments ?? EMPTY_COMMENTS)
  const actions = useChatStore(useShallow((s) => ({
    add: s.addReplyComment,
    update: s.updateReplyComment,
    remove: s.removeReplyComment,
  })))
  const layerRef = useRef<HTMLDivElement>(null)
  const [note, setNote] = useState<Note | null>(null)
  const [layout, setLayout] = useState<Layout>(EMPTY_LAYOUT)
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  // Read by blur, which can fire while the note unmounts after Escape.
  const noteRef = useRef(note)
  noteRef.current = note

  useImperativeHandle(ref, () => ({
    startDraft: (draft) => setNote({ ...draft, text: '' }),
  }), [])

  const noteKey = note ? `${note.id ?? DRAFT_KEY}\u0000${note.messageId}\u0000${note.anchorText}` : ''

  const refresh = useCallback(() => {
    const root = rootRef.current
    if (!root) return
    const origin = root.getBoundingClientRect()
    const strokes: Stroke[] = []
    const pins: Record<string, ViewportCorner> = {}
    const open = noteRef.current
    const place = (key: string, anchor: ReplyCommentAnchor, swatch: StickySwatch) => {
      const range = locate(root, anchor)
      if (!range) return
      const rects = localRects(range, origin)
      const corner = topRightOfRects(rects, PIN)
      if (!corner) return
      strokes.push({ key, bands: highlightBandsFromRects(rects), swatch })
      pins[key] = corner
    }
    for (const c of comments) place(c.id, c, stickyForComment(c.id, comments))
    if (open && !open.id) place(DRAFT_KEY, open, stickyForDraft(comments.length))
    const pin = open ? pins[open.id ?? DRAFT_KEY] : undefined
    // Nothing drawn: keep the same empty layout so React skips the render.
    if (strokes.length === 0 && !pin) setLayout(EMPTY_LAYOUT)
    else setLayout({ strokes, pins, note: pin ? notePosition(pin, root, origin) : null })
  }, [comments, rootRef])

  // noteKey: re-place when the note opens, closes or switches, not per keystroke.
  useLayoutEffect(() => { refresh() }, [refresh, noteKey])

  const active = comments.length > 0 || note !== null
  useEffect(() => {
    const root = rootRef.current
    if (!root || !active) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; refresh() }, 60)
    }
    // Rows remount (virtualized), stream and re-render: find the passages again.
    const mutations = new MutationObserver((records) => {
      const layer = layerRef.current
      if (records.some((r) => !layer?.contains(r.target))) schedule()
    })
    mutations.observe(root, { childList: true, subtree: true, characterData: true })
    const resize = new ResizeObserver(schedule)
    resize.observe(root)
    return () => {
      mutations.disconnect()
      resize.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [active, refresh, rootRef])

  const openSaved = useCallback((comment: ReplyComment) => {
    setNote({ ...comment })
  }, [])

  useEffect(() => onReplyCommentEditRequest((id) => {
    const comment = comments.find((c) => c.id === id)
    if (comment) openSaved(comment)
  }), [comments, openSaved])

  // A click on a saved highlight (not the end of a drag) opens its note.
  useEffect(() => {
    const root = rootRef.current
    if (!root || comments.length === 0) return
    const onClick = (e: MouseEvent) => {
      if (!window.getSelection()?.isCollapsed) return
      if ((e.target as Element | null)?.closest?.(`[${STICKY_UI_ATTR}]`)) return
      const origin = root.getBoundingClientRect()
      const x = e.clientX - origin.left
      const y = e.clientY - origin.top
      const hit = layoutRef.current.strokes.find((s) => s.key !== DRAFT_KEY && s.bands.some((b) =>
        x >= b.left && x <= b.left + b.width && y >= b.top && y <= b.top + b.height))
      const comment = hit && comments.find((c) => c.id === hit.key)
      if (comment) openSaved(comment)
    }
    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [comments, openSaved, rootRef])

  const target = scope ?? undefined
  const save = useCallback((current: Note) => {
    const text = current.text.trim()
    if (current.id) {
      if (text) actions.update(current.id, text, target)
      else actions.remove(current.id, target)
    } else if (text) {
      const id = `reply-comment-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      actions.add({ id, messageId: current.messageId, anchorText: current.anchorText, quote: current.quote, text }, target)
    }
    setNote(null)
  }, [actions, target])

  useEffect(() => {
    if (!note) return
    const onKeyDown = (e: KeyboardEvent) => {
      const el = document.activeElement
      if (!(el instanceof HTMLTextAreaElement) || el.dataset.planDraft === undefined || !layerRef.current?.contains(el)) return
      if (e.key === 'Enter') {
        // Keep the composer from sending; ⌘/Ctrl+Enter saves the note.
        e.stopPropagation()
        if ((e.metaKey || e.ctrlKey) && !e.isComposing) {
          e.preventDefault()
          save(note)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setNote(null)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [note, save])

  const swatchOf = (key: string): StickySwatch =>
    key === DRAFT_KEY ? stickyForDraft(comments.length) : stickyForComment(key, comments)
  const openKey = note ? note.id ?? DRAFT_KEY : null

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0">
      {/* No z-index on strokes: a stacking context would isolate their blend from the text. */}
      {layout.strokes.flatMap(({ key, bands, swatch }) => bands.map((band, i) => (
        <MarkerStroke key={`${key}-${i}`} band={band} swatch={swatch} isDark={isDark} seed={strokeSeed(key, i)} className="absolute" />
      )))}
      {comments.map((c, index) => {
        const pos = layout.pins[c.id]
        if (!pos || openKey === c.id) return null
        const swatch = swatchOf(c.id)
        return (
          <StickyPinButton
            key={c.id}
            swatch={swatch}
            isDark={isDark}
            index={index}
            size={PIN}
            position={pos}
            label={`${t('chat.plan.comments')} · ${swatch.label}`}
            className="pointer-events-auto absolute z-10"
            onClick={() => openSaved(c)}
          />
        )
      })}
      {note && openKey && layout.note && (
        <div
          data-plan-sticky-ui
          className="pointer-events-auto absolute z-10"
          style={{ top: layout.note.top, left: layout.note.left }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <StickyNoteEditor
            key={openKey}
            swatch={swatchOf(openKey)}
            isDark={isDark}
            autoFocus
            value={note.text}
            placeholder={t('chat.plan.commentPlaceholder')}
            dismissLabel={note.id ? t('chat.plan.removeComment') : t('chat.plan.cancelComment')}
            onChange={(text) => setNote((n) => (n ? { ...n, text } : n))}
            onDismiss={() => {
              if (note.id) actions.remove(note.id, target)
              setNote(null)
            }}
            onCommit={() => {
              const current = noteRef.current
              if (current) save(current)
            }}
          />
        </div>
      )}
    </div>
  )
}

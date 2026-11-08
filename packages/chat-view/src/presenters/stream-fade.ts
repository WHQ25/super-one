import { createContext, type ComponentType } from 'react'
import type { BlockProps } from 'streamdown'
import type { Plugin } from 'unified'

/** Block wrapper inside a fading Streamdown tree. Virtualization supplies its own. */
export const FadeBlockInnerContext = createContext<ComponentType<BlockProps> | undefined>(undefined)

/** One-shot opacity fade for a streaming commit. Match `.stream-fade` in chat-md.css. */
export const STREAM_FADE_MS = 120

export const STREAM_FADE_CLASS = 'stream-fade'

const SKIP_TAGS = new Set(['pre', 'svg', 'math', 'annotation'])

type HastNode = {
  type: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: HastNode[]
}

type Mark = { end: number, bornAt: number }

type RenderMark = { start: number, end: number, fade: boolean }

type FadeState = {
  now: () => number
  marks: Mark[]
  primed: boolean
  parsed: boolean
  lastTotal: number
  pendingBorn: number
}

/**
 * Streamdown caches one markdown processor per plugin name, so every block
 * shares this attacher. Each block binds its own state immediately before
 * the synchronous parse.
 */
const active: { state: FadeState | null } = { state: null }

function createState(now: () => number): FadeState {
  return {
    now,
    marks: [],
    primed: false,
    parsed: false,
    lastTotal: 0,
    pendingBorn: 0,
  }
}

function countText(node: HastNode): number {
  if (node.type === 'element' && node.tagName && SKIP_TAGS.has(node.tagName)) return 0
  if (node.type === 'text') return node.value?.length ?? 0
  let total = 0
  for (const child of node.children ?? []) total += countText(child)
  return total
}

function renderMarks(state: FadeState): RenderMark[] {
  const total = state.lastTotal
  const now = state.now()
  const marks: RenderMark[] = []
  let start = 0
  for (const mark of state.marks) {
    if (mark.end <= start) continue
    if (mark.end > total) break
    marks.push({
      start,
      end: mark.end,
      fade: mark.bornAt > 0 && now - mark.bornAt < STREAM_FADE_MS,
    })
    start = mark.end
  }
  if (total > start) {
    if (!state.pendingBorn) state.pendingBorn = now
    marks.push({ start, end: total, fade: true })
  }
  return marks
}

function fadeSpan(text: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [STREAM_FADE_CLASS] },
    children: [{ type: 'text', value: text }],
  }
}

function splitValue(value: string, nodeStart: number, marks: RenderMark[]): HastNode[] {
  const nodeEnd = nodeStart + value.length
  const pieces: { text: string, fade: boolean }[] = []
  let cursor = nodeStart
  for (const mark of marks) {
    if (mark.end <= cursor) continue
    if (mark.start >= nodeEnd) break
    const from = Math.max(mark.start, cursor)
    const to = Math.min(mark.end, nodeEnd)
    if (to <= from) continue
    pieces.push({ text: value.slice(from - nodeStart, to - nodeStart), fade: mark.fade })
    cursor = to
  }
  if (cursor < nodeEnd) {
    pieces.push({ text: value.slice(cursor - nodeStart), fade: false })
  }
  if (pieces.length === 1 && !pieces[0].fade) return [{ type: 'text', value }]
  return pieces.map(piece => piece.fade ? fadeSpan(piece.text) : { type: 'text', value: piece.text })
}

function applyMarks(node: HastNode, marks: RenderMark[], index: { value: number }) {
  if (node.type === 'element' && node.tagName && SKIP_TAGS.has(node.tagName)) return
  if (!node.children) return
  const next: HastNode[] = []
  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      const start = index.value
      index.value += child.value.length
      next.push(...splitValue(child.value, start, marks))
    } else {
      applyMarks(child, marks, index)
      next.push(child)
    }
  }
  node.children = next
}

function transform(tree: HastNode, state: FadeState) {
  state.parsed = true
  state.lastTotal = countText(tree)
  const covered = state.marks.length ? state.marks[state.marks.length - 1].end : 0
  if (state.primed && state.lastTotal < covered) {
    state.marks = []
    state.pendingBorn = 0
  }
  applyMarks(tree, renderMarks(state), { value: 0 })
}

function streamFadePlugin(this: void): (tree: HastNode) => void {
  return tree => {
    const state = active.state
    if (!state) return
    transform(tree, state)
  }
}

export type StreamFadeController = {
  rehype: Plugin
  bind: () => void
  unbind: () => void
  commit: () => void
  reset: () => void
}

export function createStreamFadePlugin(now: () => number = () => performance.now()): StreamFadeController {
  const state = createState(now)
  return {
    rehype: streamFadePlugin as Plugin,
    bind() {
      active.state = state
    },
    unbind() {
      if (active.state === state) active.state = null
    },
    commit() {
      if (!state.parsed) return
      const total = state.lastTotal
      if (!state.primed) {
        state.primed = true
        const bornAt = state.pendingBorn || state.now()
        state.pendingBorn = 0
        state.marks = total > 0 ? [{ end: total, bornAt }] : []
        return
      }
      const covered = state.marks.length ? state.marks[state.marks.length - 1].end : 0
      if (total > covered) state.marks.push({ end: total, bornAt: state.pendingBorn || state.now() })
      state.pendingBorn = 0
    },
    reset() {
      state.marks = []
      state.primed = false
      state.parsed = false
      state.lastTotal = 0
      state.pendingBorn = 0
      if (active.state === state) active.state = null
    },
  }
}

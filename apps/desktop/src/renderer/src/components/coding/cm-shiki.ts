import { RangeSetBuilder, StateEffect, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import type { BundledLanguage, BundledTheme, GrammarState, Highlighter, ThemedToken } from 'shiki'
import {
  HIGHLIGHT_CHUNK_SIZE,
  getFileHighlighter,
  getFileHighlighterSync,
  getShikiTarget,
} from '@/lib/shiki-highlighter'

const shikiReadyEffect = StateEffect.define<null>()
const decorationCache = new Map<string, Decoration>()

const MAX_SYNC_CATCHUP_CHUNKS = 8
const IDLE_BATCH_CHUNKS = 8
const MAX_IDLE_GRAMMAR_CHUNKS = 300
const MAX_LINE_HIGHLIGHT_CHARS = 2000

interface TokenSpan {
  from: number
  to: number
  deco: Decoration
}

interface HighlightedChunk {
  endState: GrammarState | undefined
  lines: TokenSpan[][]
  exact: boolean
}

function toStyleAttr(token: ThemedToken): string {
  const parts: string[] = []
  if (token.color) parts.push(`color:${token.color}`)
  if (token.htmlStyle) {
    for (const [k, v] of Object.entries(token.htmlStyle)) {
      if (!v || k === 'background-color' || k === 'backgroundColor' || k === 'color') continue
      const prop = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      parts.push(`${prop}:${v}`)
    }
  }
  return parts.join(';')
}

function getTokenDecoration(styleAttr: string): Decoration {
  let cached = decorationCache.get(styleAttr)
  if (!cached) {
    cached = Decoration.mark({ attributes: { style: styleAttr } })
    decorationCache.set(styleAttr, cached)
  }
  return cached
}

function convertLineTokens(rawLines: ThemedToken[][]): TokenSpan[][] {
  return rawLines.map((tokens) => {
    const spans: TokenSpan[] = []
    let offset = 0
    for (const tok of tokens) {
      const len = tok.content.length
      if (len > 0) {
        const styleAttr = toStyleAttr(tok)
        if (styleAttr) {
          spans.push({ from: offset, to: offset + len, deco: getTokenDecoration(styleAttr) })
        }
      }
      offset += len
    }
    return spans
  })
}

function sliceChunkCode(doc: EditorView['state']['doc'], startLine: number, endLine: number): string {
  const lines: string[] = []
  for (let ln = startLine; ln <= endLine; ln++) {
    const text = doc.line(ln).text
    lines.push(text.length > MAX_LINE_HIGHLIGHT_CHARS ? text.slice(0, MAX_LINE_HIGHLIGHT_CHARS) : text)
  }
  return lines.join('\n')
}

function tokenizeChunk(
  hl: Highlighter,
  chunkCode: string,
  lang: string,
  theme: BundledTheme,
  prevState: GrammarState | undefined,
  exact: boolean,
): HighlightedChunk {
  let rawTokens: ThemedToken[][]
  let endState: GrammarState | undefined
  try {
    rawTokens = hl.codeToTokensBase(chunkCode, {
      lang: lang as BundledLanguage,
      theme,
      grammarState: prevState,
    })
    endState = hl.getLastGrammarState(rawTokens) as GrammarState | undefined
  } catch {
    rawTokens = hl.codeToTokensBase(chunkCode, { lang: lang as BundledLanguage, theme })
    endState = undefined
  }
  return { endState, lines: convertLineTokens(rawTokens), exact }
}

export function createShikiExtension(language: string, isDark: boolean): Extension {
  if (!language || language === 'text') return []
  const { theme, lang } = getShikiTarget(isDark, language)

  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      private chunks = new Map<number, HighlightedChunk>()
      private exactCount = 0
      private loading = false
      private idleId: number | null = null
      private destroyed = false

      constructor(view: EditorView) {
        this.decorations = this.buildDecorations(view)
      }

      update(vu: ViewUpdate) {
        if (vu.docChanged) {
          let minFrom = Infinity
          vu.changes.iterChangedRanges((fromA) => {
            if (fromA < minFrom) minFrom = fromA
          })
          if (minFrom < Infinity) {
            const clamped = Math.min(minFrom, vu.startState.doc.length)
            const lineNum = vu.startState.doc.lineAt(clamped).number
            const firstDirtyChunk = Math.floor((lineNum - 1) / HIGHLIGHT_CHUNK_SIZE)
            if (firstDirtyChunk < this.exactCount) {
              this.exactCount = firstDirtyChunk
            }
            for (const key of this.chunks.keys()) {
              if (key >= firstDirtyChunk) this.chunks.delete(key)
            }
            this.cancelIdle()
          }
        }

        const readyTriggered = vu.transactions.some((tr) =>
          tr.effects.some((e) => e.is(shikiReadyEffect)),
        )
        if (vu.docChanged || vu.viewportChanged || readyTriggered) {
          this.decorations = this.buildDecorations(vu.view)
        }
      }

      destroy() {
        this.destroyed = true
        this.cancelIdle()
      }

      private cancelIdle() {
        if (this.idleId !== null && typeof cancelIdleCallback === 'function') {
          cancelIdleCallback(this.idleId)
          this.idleId = null
        }
      }

      private ensureLoaded(view: EditorView) {
        if (this.loading) return
        this.loading = true
        getFileHighlighter(theme, lang)
          .then(() => {
            this.loading = false
            if (!this.destroyed) {
              view.dispatch({ effects: shikiReadyEffect.of(null) })
            }
          })
          .catch(() => {
            this.loading = false
          })
      }

      private advanceExact(hl: Highlighter, doc: EditorView['state']['doc'], targetExclusive: number) {
        const totalChunks = Math.ceil(doc.lines / HIGHLIGHT_CHUNK_SIZE)
        const limit = Math.min(targetExclusive, totalChunks)
        while (this.exactCount < limit) {
          const idx = this.exactCount
          const startLine = idx * HIGHLIGHT_CHUNK_SIZE + 1
          const endLine = Math.min(doc.lines, startLine + HIGHLIGHT_CHUNK_SIZE - 1)
          const prevState = idx > 0 ? this.chunks.get(idx - 1)?.endState : undefined
          const chunk = tokenizeChunk(hl, sliceChunkCode(doc, startLine, endLine), lang, theme, prevState, true)
          this.chunks.set(idx, chunk)
          this.exactCount = idx + 1
        }
      }

      private scheduleIdleCatchup(view: EditorView, targetChunk: number) {
        if (this.idleId !== null || typeof requestIdleCallback !== 'function') return
        if (targetChunk > MAX_IDLE_GRAMMAR_CHUNKS) return
        this.idleId = requestIdleCallback(() => {
          this.idleId = null
          if (this.destroyed) return
          const hl = getFileHighlighterSync(theme, lang)
          const doc = view.state.doc
          if (!hl || doc.length === 0) return
          const nextStop = Math.min(targetChunk + 1, this.exactCount + IDLE_BATCH_CHUNKS)
          this.advanceExact(hl, doc, nextStop)
          if (this.exactCount <= targetChunk) {
            this.scheduleIdleCatchup(view, targetChunk)
          } else {
            view.dispatch({ effects: shikiReadyEffect.of(null) })
          }
        }, { timeout: 120 })
      }

      private buildDecorations(view: EditorView): DecorationSet {
        const doc = view.state.doc
        if (doc.length === 0) return Decoration.none

        const hl = getFileHighlighterSync(theme, lang)
        if (!hl) {
          this.ensureLoaded(view)
          return Decoration.none
        }

        const ranges = view.visibleRanges
        if (ranges.length === 0) return Decoration.none

        let minVisiblePos = doc.length
        let maxVisiblePos = 0
        for (const r of ranges) {
          if (r.from < minVisiblePos) minVisiblePos = r.from
          if (r.to > maxVisiblePos) maxVisiblePos = r.to
        }
        const minLine = doc.lineAt(Math.min(minVisiblePos, doc.length)).number
        const maxLine = doc.lineAt(Math.min(maxVisiblePos, doc.length)).number
        const minChunk = Math.floor((minLine - 1) / HIGHLIGHT_CHUNK_SIZE)
        const maxChunk = Math.floor((maxLine - 1) / HIGHLIGHT_CHUNK_SIZE)

        if (maxChunk - this.exactCount < MAX_SYNC_CATCHUP_CHUNKS) {
          this.advanceExact(hl, doc, maxChunk + 1)
        } else {
          const localStart = Math.max(0, minChunk - 1)
          let prevState = localStart > 0 ? this.chunks.get(localStart - 1)?.endState : undefined
          for (let idx = localStart; idx <= maxChunk; idx++) {
            const existing = this.chunks.get(idx)
            if (existing) {
              prevState = existing.endState
              continue
            }
            const startLine = idx * HIGHLIGHT_CHUNK_SIZE + 1
            if (startLine > doc.lines) break
            const endLine = Math.min(doc.lines, startLine + HIGHLIGHT_CHUNK_SIZE - 1)
            const chunk = tokenizeChunk(hl, sliceChunkCode(doc, startLine, endLine), lang, theme, prevState, false)
            this.chunks.set(idx, chunk)
            prevState = chunk.endState
          }
          this.scheduleIdleCatchup(view, maxChunk)
        }

        const builder = new RangeSetBuilder<Decoration>()
        let lastLine = 0
        for (const range of ranges) {
          const fromLine = Math.max(lastLine + 1, doc.lineAt(range.from).number)
          const toLine = doc.lineAt(Math.min(range.to, doc.length)).number
          for (let lineNum = fromLine; lineNum <= toLine; lineNum++) {
            lastLine = lineNum
            const chunkIdx = Math.floor((lineNum - 1) / HIGHLIGHT_CHUNK_SIZE)
            const lineIdx = (lineNum - 1) % HIGHLIGHT_CHUNK_SIZE
            const spans = this.chunks.get(chunkIdx)?.lines[lineIdx]
            if (!spans || spans.length === 0) continue
            const lineObj = doc.line(lineNum)
            const lineLen = lineObj.length
            for (const span of spans) {
              const to = Math.min(span.to, lineLen)
              if (to > span.from) {
                builder.add(lineObj.from + span.from, lineObj.from + to, span.deco)
              }
            }
          }
        }

        return builder.finish()
      }
    },
    { decorations: (v) => v.decorations },
  )
}

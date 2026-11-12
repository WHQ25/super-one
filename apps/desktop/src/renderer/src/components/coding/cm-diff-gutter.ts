import { RangeSetBuilder, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, EditorView, GutterMarker, ViewPlugin, gutter, gutterLineClass, type DecorationSet } from '@codemirror/view'
import { findChangeForGutterLine, type EditorDiffChange } from './editor-diff'

export interface GutterHoverPayload {
  change: EditorDiffChange
  anchorRect: { top: number; bottom: number; left: number; right: number }
}

export const setDiffChangesEffect = StateEffect.define<readonly EditorDiffChange[]>()
export const setFlashLineEffect = StateEffect.define<{ line: number | null; fading: boolean }>()

export const diffChangesField = StateField.define<readonly EditorDiffChange[]>({
  create: () => [],
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setDiffChangesEffect)) return effect.value
    }
    return value
  },
})

const flashLineDeco = Decoration.line({ class: 'cm-flash-line' })
const flashLineFadeDeco = Decoration.line({ class: 'cm-flash-line-fade' })

export const flashLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setFlashLineEffect)) {
        const { line, fading } = effect.value
        if (line == null || line < 1 || line > tr.state.doc.lines) return Decoration.none
        const pos = tr.state.doc.line(line).from
        const builder = new RangeSetBuilder<Decoration>()
        builder.add(pos, pos, fading ? flashLineFadeDeco : flashLineDeco)
        return builder.finish()
      }
    }
    if (tr.docChanged) return value.map(tr.changes)
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})

class BarDiffMarker extends GutterMarker {
  constructor(
    readonly kind: 'added' | 'modified',
    readonly lineNumber: number,
  ) {
    super()
  }

  eq(other: GutterMarker): boolean {
    return other instanceof BarDiffMarker && other.kind === this.kind && other.lineNumber === this.lineNumber
  }

  toDOM(): Node {
    const el = document.createElement('span')
    el.className = `cm-diff-bar cm-diff-bar-${this.kind}`
    el.setAttribute('data-diff-marker', this.kind)
    el.setAttribute('data-diff-line', String(this.lineNumber))
    return el
  }
}

class DeletedDiffMarker extends GutterMarker {
  constructor(
    readonly lineNumber: number,
    readonly above: boolean,
    readonly below: boolean,
  ) {
    super()
  }

  eq(other: GutterMarker): boolean {
    return (
      other instanceof DeletedDiffMarker &&
      other.lineNumber === this.lineNumber &&
      other.above === this.above &&
      other.below === this.below
    )
  }

  toDOM(): Node {
    const wrap = document.createElement('span')
    wrap.className = 'cm-diff-del-wrap'
    wrap.setAttribute('data-diff-marker', 'deleted')
    wrap.setAttribute('data-diff-line', String(this.lineNumber))
    if (this.above) {
      const tri = document.createElement('span')
      tri.className = 'cm-diff-del cm-diff-del-above'
      wrap.appendChild(tri)
    }
    if (this.below) {
      const tri = document.createElement('span')
      tri.className = 'cm-diff-del cm-diff-del-below'
      wrap.appendChild(tri)
    }
    return wrap
  }
}

const gutterClassAdded = new (class extends GutterMarker {
  elementClass = 'cm-gutter-has-diff cm-gutter-diff-added'
})()

const gutterClassModified = new (class extends GutterMarker {
  elementClass = 'cm-gutter-has-diff cm-gutter-diff-modified'
})()

const gutterClassDeleted = new (class extends GutterMarker {
  elementClass = 'cm-gutter-has-diff cm-gutter-diff-deleted'
})()

function buildDiffMarkers(docLines: number, docLineFrom: (n: number) => number, changes: readonly EditorDiffChange[], asLineClass: boolean) {
  const builder = new RangeSetBuilder<GutterMarker>()
  if (changes.length === 0 || docLines === 0) return builder.finish()

  const byLine = new Map<number, { bar?: 'added' | 'modified'; delAbove?: boolean; delBelow?: boolean }>()
  for (const ch of changes) {
    if (ch.kind === 'added' || ch.kind === 'modified') {
      const start = Math.max(1, ch.newStartLine)
      const end = Math.min(docLines, ch.newEndLine)
      for (let ln = start; ln <= end; ln++) {
        const entry = byLine.get(ln) ?? {}
        entry.bar = ch.kind
        byLine.set(ln, entry)
      }
    } else {
      const ln = Math.max(1, Math.min(docLines, ch.anchorLine))
      const entry = byLine.get(ln) ?? {}
      if (ch.deletePosition === 'above') entry.delAbove = true
      else entry.delBelow = true
      byLine.set(ln, entry)
    }
  }

  const sortedLines = Array.from(byLine.keys()).sort((a, b) => a - b)
  for (const ln of sortedLines) {
    const info = byLine.get(ln)!
    const pos = docLineFrom(ln)
    if (asLineClass) {
      const marker = info.bar === 'added'
        ? gutterClassAdded
        : info.bar === 'modified'
          ? gutterClassModified
          : gutterClassDeleted
      builder.add(pos, pos, marker)
    } else if (info.bar) {
      builder.add(pos, pos, new BarDiffMarker(info.bar, ln))
    } else {
      builder.add(pos, pos, new DeletedDiffMarker(ln, !!info.delAbove, !!info.delBelow))
    }
  }

  return builder.finish()
}

export function createDiffGutterExtensions(onHoverChange: (payload: GutterHoverPayload | null) => void): Extension {
  const lineClassExt = gutterLineClass.compute([diffChangesField, 'doc'], (state) => {
    const changes = state.field(diffChangesField)
    return buildDiffMarkers(state.doc.lines, (n) => state.doc.line(n).from, changes, true)
  })

  const markerGutterExt = gutter({
    class: 'cm-diff-markers',
    markers(view) {
      const changes = view.state.field(diffChangesField)
      return buildDiffMarkers(view.state.doc.lines, (n) => view.state.doc.line(n).from, changes, false)
    },
  })

  const resolveHover = (view: EditorView, event: MouseEvent): GutterHoverPayload | null => {
    const target = event.target as HTMLElement | null
    const guttersEl = target?.closest?.('.cm-gutters') as HTMLElement | null
    if (!guttersEl) return null

    const changes = view.state.field(diffChangesField)
    if (changes.length === 0) return null

    const guttersRect = guttersEl.getBoundingClientRect()
    let lineNum: number | null = null
    let pointerHalf: 'top' | 'bottom' = 'bottom'
    let top = guttersRect.top
    let bottom = guttersRect.bottom

    if (guttersRect.height > 0 && view.contentHeight > 0) {
      const relY = Math.max(0, event.clientY - view.documentTop)
      const block = view.lineBlockAtHeight(relY)
      lineNum = view.state.doc.lineAt(block.from).number
      top = view.documentTop + block.top
      bottom = top + block.height
      pointerHalf = event.clientY - top < block.height / 2 ? 'top' : 'bottom'
    } else {
      const markerEl = target?.closest?.('[data-diff-line]') as HTMLElement | null
      if (markerEl) {
        lineNum = Number.parseInt(markerEl.getAttribute('data-diff-line') ?? '', 10)
        if (target?.classList?.contains('cm-diff-del-above')) pointerHalf = 'top'
      } else {
        const gutterCell = target?.closest?.('.cm-gutterElement') as HTMLElement | null
        const parsed = Number.parseInt(gutterCell?.textContent?.trim() ?? '', 10)
        if (Number.isFinite(parsed) && parsed >= 1) lineNum = parsed
      }
    }

    if (!lineNum || lineNum < 1 || lineNum > view.state.doc.lines) return null
    const change = findChangeForGutterLine(changes, lineNum, pointerHalf)
    if (!change) return null

    return {
      change,
      anchorRect: {
        top,
        bottom,
        left: guttersRect.left,
        right: guttersRect.right,
      },
    }
  }

  const hoverEventsExt = ViewPlugin.fromClass(
    class {
      private onMove: (e: MouseEvent) => void
      private onOver: (e: MouseEvent) => void
      private onLeave: () => void

      constructor(private view: EditorView) {
        this.onMove = (event: MouseEvent) => {
          onHoverChange(resolveHover(this.view, event))
        }
        this.onOver = (event: MouseEvent) => {
          const payload = resolveHover(this.view, event)
          if (payload) onHoverChange(payload)
        }
        this.onLeave = () => {
          onHoverChange(null)
        }
        view.dom.addEventListener('mousemove', this.onMove)
        view.dom.addEventListener('mouseover', this.onOver)
        view.dom.addEventListener('mouseleave', this.onLeave)
      }

      destroy() {
        this.view.dom.removeEventListener('mousemove', this.onMove)
        this.view.dom.removeEventListener('mouseover', this.onOver)
        this.view.dom.removeEventListener('mouseleave', this.onLeave)
      }
    },
  )

  return [diffChangesField, lineClassExt, markerGutterExt, hoverEventsExt]
}

import {
  Annotation,
  Compartment,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, lineNumbers, type DecorationSet } from '@codemirror/view'
import { diffChangesField, setFlashLineEffect } from './cm-diff-gutter'
import { formatEditorSelectionQuote } from './editor-diff'
import type { CapturedFileSelection } from './FileSelectionContextMenuZone'

export interface LineNumbersController {
  extension: Extension
  setEnabled: (view: EditorView, enabled: boolean) => void
}

export function createLineNumbersController(initialEnabled: boolean): LineNumbersController {
  const compartment = new Compartment()
  let enabled = initialEnabled
  let activeLine = 1

  const buildForLine = (line: number): Extension => {
    if (!enabled) {
      return lineNumbers()
    }
    return lineNumbers({
      formatNumber: (lineNo, state) => {
        if (lineNo > state.doc.lines || lineNo === line) {
          return String(lineNo)
        }
        return String(Math.abs(lineNo - line))
      },
    })
  }

  const lineTrackerField = StateField.define<number>({
    create(state) {
      activeLine = state.doc.lineAt(state.selection.main.head).number
      return activeLine
    },
    update(_value, tr) {
      return tr.state.doc.lineAt(tr.state.selection.main.head).number
    },
  })

  const extender = EditorState.transactionExtender.of((tr) => {
    if (!enabled) return null
    const nextLine = tr.state.doc.lineAt(tr.state.selection.main.head).number
    if (nextLine === activeLine) return null
    activeLine = nextLine
    return { effects: compartment.reconfigure(buildForLine(nextLine)) }
  })

  return {
    extension: [
      lineTrackerField,
      compartment.of(buildForLine(1)),
      extender,
    ],
    setEnabled(view: EditorView, nextEnabled: boolean) {
      const currentLine = view.state.doc.lineAt(view.state.selection.main.head).number
      if (enabled === nextEnabled && (!nextEnabled || activeLine === currentLine)) {
        return
      }
      enabled = nextEnabled
      activeLine = currentLine
      view.dispatch({ effects: compartment.reconfigure(buildForLine(currentLine)) })
    },
  }
}

export function scrollViewToLineWithFlash(
  view: EditorView,
  getLatestView: () => EditorView | null,
  targetLine: number,
): () => void {
  const clampedLine = Math.max(1, Math.min(targetLine, view.state.doc.lines))
  const lineObj = view.state.doc.line(clampedLine)
  view.dispatch({
    selection: { anchor: lineObj.from },
    effects: [
      EditorView.scrollIntoView(lineObj.from, { y: 'center' }),
      setFlashLineEffect.of({ line: clampedLine, fading: false }),
    ],
  })
  const fadeStart = setTimeout(() => {
    getLatestView()?.dispatch({
      effects: setFlashLineEffect.of({ line: clampedLine, fading: true }),
    })
  }, 5000)
  const fadeEnd = setTimeout(() => {
    getLatestView()?.dispatch({
      effects: setFlashLineEffect.of({ line: null, fading: false }),
    })
  }, 6100)
  return () => {
    clearTimeout(fadeStart)
    clearTimeout(fadeEnd)
  }
}

export function captureViewSelection(
  view: EditorView | null,
  fullFilePath: string,
): CapturedFileSelection | null {
  if (!view) return null
  const sel = view.state.selection.main
  if (sel.empty) return null

  const doc = view.state.doc
  const copyText = view.state.sliceDoc(sel.from, sel.to)
  const startLineObj = doc.lineAt(sel.from)
  let endLineObj = doc.lineAt(sel.to)
  const startLine = startLineObj.number
  const startCol = sel.from - startLineObj.from
  let endLine = endLineObj.number
  let endCol = sel.to - endLineObj.from

  if (endCol === 0 && endLine > startLine) {
    endLine -= 1
    endLineObj = doc.line(endLine)
    endCol = endLineObj.length
  }

  const changes = view.state.field(diffChangesField, false) ?? []
  const quoteText = formatEditorSelectionQuote({
    filePath: fullFilePath,
    lineText: (line) => doc.line(line).text,
    lineCount: doc.lines,
    startLine,
    endLine,
    startCol,
    endCol,
    changes,
  })
  return { copyText, quoteText: quoteText || copyText }
}

export function attachHorizontalGutterClip(view: EditorView, onScroll: () => void): () => void {
  let lastScrollLeft = 0
  const handleScroll = () => {
    onScroll()
    const sl = view.scrollDOM.scrollLeft
    if (sl !== lastScrollLeft) {
      lastScrollLeft = sl
      if (sl > 0) {
        const gw = (view.dom.querySelector('.cm-gutters') as HTMLElement | null)?.offsetWidth ?? 0
        view.scrollDOM.dataset.scrolledX = 'true'
        view.scrollDOM.style.setProperty('--cm-scroll-x', `${sl}px`)
        view.scrollDOM.style.setProperty('--cm-layer-clip-x', `${gw + sl}px`)
      } else {
        delete view.scrollDOM.dataset.scrolledX
        view.scrollDOM.style.removeProperty('--cm-scroll-x')
        view.scrollDOM.style.removeProperty('--cm-layer-clip-x')
      }
    }
  }
  view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true })
  return () => view.scrollDOM.removeEventListener('scroll', handleScroll)
}

const gutterSelectAnnotation = Annotation.define<boolean>()
const setGutterLineSelectionEffect = StateEffect.define<{ fromLine: number; toLine: number } | null>()
const gutterSelectedLineDecoration = Decoration.line({ class: 'cm-gutter-selected-line' })

const gutterLineSelectionField = StateField.define<{ fromLine: number; toLine: number } | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGutterLineSelectionEffect)) return effect.value
    }
    if (tr.docChanged || (tr.selection && !tr.annotation(gutterSelectAnnotation))) {
      return null
    }
    return value
  },
  provide: (field) =>
    EditorView.editorAttributes.from(field, (range): Record<string, string> =>
      range ? { class: 'cm-has-gutter-line-selection' } : {},
    ),
})

const gutterLineSelectionDecorations = EditorView.decorations.compute(
  [gutterLineSelectionField],
  (state): DecorationSet => {
    const range = state.field(gutterLineSelectionField, false)
    if (!range) return Decoration.none
    const fromLine = Math.max(1, Math.min(range.fromLine, state.doc.lines))
    const toLine = Math.max(fromLine, Math.min(range.toLine, state.doc.lines))
    const builder = new RangeSetBuilder<Decoration>()
    for (let lineNo = fromLine; lineNo <= toLine; lineNo++) {
      builder.add(state.doc.line(lineNo).from, state.doc.line(lineNo).from, gutterSelectedLineDecoration)
    }
    return builder.finish()
  },
)

function lineRangeSelection(state: EditorState, anchorLine: number, targetLine: number): { anchor: number; head: number } {
  const doc = state.doc
  const clampedAnchor = Math.max(1, Math.min(anchorLine, doc.lines))
  const clampedTarget = Math.max(1, Math.min(targetLine, doc.lines))

  if (clampedTarget >= clampedAnchor) {
    return {
      anchor: doc.line(clampedAnchor).from,
      head: doc.line(clampedTarget).to,
    }
  }
  return {
    anchor: doc.line(clampedAnchor).to,
    head: doc.line(clampedTarget).from,
  }
}

export function createLineNumberSelectionExtension(): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      private anchorLine: number | null = null
      private lastTargetLine: number | null = null

      constructor(private readonly view: EditorView) {
        this.view.dom.addEventListener('mousedown', this.onMouseDown)
      }

      private lineFromClientY(clientY: number): number {
        const docHeight = Math.max(0, Math.min(clientY - this.view.documentTop, this.view.contentHeight))
        const block = this.view.lineBlockAtHeight(docHeight)
        return this.view.state.doc.lineAt(block.from).number
      }

      private selectLines(anchorLine: number, targetLine: number) {
        const doc = this.view.state.doc
        const clampedAnchor = Math.max(1, Math.min(anchorLine, doc.lines))
        const clampedTarget = Math.max(1, Math.min(targetLine, doc.lines))
        const sel = lineRangeSelection(this.view.state, clampedAnchor, clampedTarget)
        const fromLine = Math.min(clampedAnchor, clampedTarget)
        const toLine = Math.max(clampedAnchor, clampedTarget)
        this.view.dispatch({
          selection: sel,
          annotations: gutterSelectAnnotation.of(true),
          effects: [
            setGutterLineSelectionEffect.of({ fromLine, toLine }),
            EditorView.scrollIntoView(doc.line(clampedTarget).from),
          ],
        })
      }

      private onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return
        const target = event.target as HTMLElement | null
        const lineNumbersEl = target?.closest?.('.cm-lineNumbers')
        if (!lineNumbersEl || !this.view.dom.contains(lineNumbersEl)) return

        event.preventDefault()
        this.view.focus()
        const clickedLine = this.lineFromClientY(event.clientY)
        const anchorLine = event.shiftKey
          ? this.view.state.doc.lineAt(this.view.state.selection.main.anchor).number
          : clickedLine

        this.anchorLine = anchorLine
        this.lastTargetLine = clickedLine
        this.selectLines(anchorLine, clickedLine)

        window.addEventListener('mousemove', this.onMouseMove)
        window.addEventListener('mouseup', this.onMouseUp)
        window.addEventListener('blur', this.onMouseUp)
      }

      private onMouseMove = (event: MouseEvent) => {
        if (this.anchorLine == null) return
        const targetLine = this.lineFromClientY(event.clientY)
        if (targetLine === this.lastTargetLine) return
        this.lastTargetLine = targetLine
        this.selectLines(this.anchorLine, targetLine)
      }

      private onMouseUp = () => {
        this.anchorLine = null
        this.lastTargetLine = null
        window.removeEventListener('mousemove', this.onMouseMove)
        window.removeEventListener('mouseup', this.onMouseUp)
        window.removeEventListener('blur', this.onMouseUp)
      }

      destroy() {
        this.onMouseUp()
        this.view.dom.removeEventListener('mousedown', this.onMouseDown)
      }
    },
  )
  return [gutterLineSelectionField, gutterLineSelectionDecorations, plugin]
}

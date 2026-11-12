import { Compartment, EditorState, type Extension, StateField } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
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

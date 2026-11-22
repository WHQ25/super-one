// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { createLineNumberSelectionExtension } from './cm-editor-helpers'

describe('createLineNumberSelectionExtension', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    document.body.innerHTML = ''
  })

  function setupEditor(doc = 'line one\nline two\nline three\nline four') {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: [lineNumbers(), createLineNumberSelectionExtension()],
      }),
      parent,
    })
    Object.defineProperty(view, 'documentTop', { value: 0, configurable: true })
    Object.defineProperty(view, 'contentHeight', { value: 80, configurable: true })
    view.lineBlockAtHeight = (y: number) => {
      const lineIdx = Math.max(1, Math.min(4, Math.floor(y / 20) + 1))
      const line = view!.state.doc.line(lineIdx)
      return { from: line.from, to: line.to, top: (lineIdx - 1) * 20, bottom: lineIdx * 20, height: 20 } as never
    }
    return view
  }

  it('selects the clicked line when clicking in the line numbers gutter', () => {
    const editor = setupEditor()
    const gutter = editor.dom.querySelector('.cm-lineNumbers') as HTMLElement

    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 25 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const sel = editor.state.selection.main
    expect(editor.state.sliceDoc(sel.from, sel.to)).toBe('line two')
  })

  it('selects a range of lines when dragging across line numbers', () => {
    const editor = setupEditor()
    const gutter = editor.dom.querySelector('.cm-lineNumbers') as HTMLElement

    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 25 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 65 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const sel = editor.state.selection.main
    expect(editor.state.sliceDoc(sel.from, sel.to)).toBe('line two\nline three\nline four')
  })

  it('supports dragging upwards and Shift+click range extension', () => {
    const editor = setupEditor()
    const gutter = editor.dom.querySelector('.cm-lineNumbers') as HTMLElement

    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 65 }))
    window.dispatchEvent(new MouseEvent('mousemove', { clientY: 25 }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const dragSel = editor.state.selection.main
    expect(editor.state.sliceDoc(dragSel.from, dragSel.to)).toBe('line two\nline three\nline four')
    expect(dragSel.anchor).toBeGreaterThan(dragSel.head)

    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 5 }))
    window.dispatchEvent(new MouseEvent('mouseup'))
    gutter.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientY: 45, shiftKey: true }))
    window.dispatchEvent(new MouseEvent('mouseup'))

    const shiftSel = editor.state.selection.main
    expect(editor.state.sliceDoc(shiftSel.from, shiftSel.to)).toBe('line one\nline two\nline three')
  })
})

/** @vitest-environment jsdom */

import { act, fireEvent, render, waitFor } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { CodeFileEditor } from './CodeFileEditor'

function readVisibleGutterNumbers(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('.cm-lineNumbers .cm-gutterElement'))
    .filter((el) => (el as HTMLElement).style.visibility !== 'hidden')
    .map((el) => (el.textContent ?? '').trim())
    .filter((text) => text.length > 0)
}

describe('CodeFileEditor Vim and relative line numbers', () => {
  const saveFile = vi.fn(() => Promise.resolve({ ok: true }))
  const saveAppSettings = vi.fn(
    async (patch: { editorVimMode?: boolean; editorRelativeLineNumbers?: boolean }) => ({
      editorVimMode: patch.editorVimMode ?? useAppStore.getState().editorVimMode,
      editorRelativeLineNumbers:
        patch.editorRelativeLineNumbers ?? useAppStore.getState().editorRelativeLineNumbers,
    }),
  )

  beforeEach(() => {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () =>
        ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0)
    }
    useAppStore.setState({
      currentFolder: '/proj',
      liquidGlass: false,
      editorVimMode: false,
      editorRelativeLineNumbers: false,
    })
    saveFile.mockClear()
    saveAppSettings.mockClear()
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      saveFile,
      saveAppSettings,
      onContentZoom: () => () => {},
      setUnsavedEditorBuffer: vi.fn(() => Promise.resolve()),
      trace: () => {},
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('lazily enables Vim motions, / search, and :w save when editorVimMode is turned on and cleans up when turned off', async () => {
    const sample = [
      'const alpha = 1',
      'const beta = 2',
      'const targetNeedle = 3',
      'const delta = 4',
      'const targetNeedleAgain = 5',
      '',
    ].join('\n')

    const { container } = render(
      <CodeFileEditor
        content={sample}
        diskContent={sample}
        gitDiff=""
        filePath="src/vim-demo.ts"
      />,
    )

    expect(container.querySelector('.cm-vim-panel')).toBeNull()

    act(() => {
      useAppStore.setState({ editorVimMode: true })
    })

    const vimPanel = await waitFor(() => {
      const el = container.querySelector('.cm-vim-panel')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    expect(vimPanel.textContent).toContain('--NORMAL--')

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!
    view.focus()

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'w' })
    })
    expect(view.state.selection.main.head).toBe('const '.length)

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: '4' })
      fireEvent.keyDown(view.contentDOM, { key: 'G' })
    })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(4)

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'G' })
    })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(6)

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'g' })
      fireEvent.keyDown(view.contentDOM, { key: 'g' })
    })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(1)

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: '/' })
    })
    const searchInput = container.querySelector('.cm-vim-panel input') as HTMLInputElement
    expect(searchInput).not.toBeNull()
    act(() => {
      searchInput.value = 'targetNeedle'
      fireEvent.input(searchInput)
      fireEvent.keyDown(searchInput, { key: 'Enter', keyCode: 13 })
    })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(3)

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'n' })
    })
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(5)

    act(() => {
      view.dispatch({
        changes: { from: 0, to: 'const alpha = 1'.length, insert: 'const alpha = 99' },
      })
    })
    expect(saveFile).not.toHaveBeenCalled()

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: ':' })
    })
    const exInput = container.querySelector('.cm-vim-panel input') as HTMLInputElement
    expect(exInput).not.toBeNull()
    await act(async () => {
      exInput.value = 'w'
      fireEvent.input(exInput)
      fireEvent.keyDown(exInput, { key: 'Enter', keyCode: 13 })
    })

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith(
        '/proj',
        'src/vim-demo.ts',
        sample.replace('const alpha = 1', 'const alpha = 99'),
      )
    })

    act(() => {
      useAppStore.setState({ editorVimMode: false })
    })
    expect(container.querySelector('.cm-vim-panel')).toBeNull()
  })

  it('isolates CJK IME from Vim Normal/Visual shortcuts and guards Insert and / search composition keys', async () => {
    const sample = [
      'const greeting = "hello"',
      'const label = "编辑器测试"',
      'const footer = "done"',
    ].join('\n')

    const { container } = render(
      <CodeFileEditor
        content={sample}
        diskContent={sample}
        gitDiff=""
        filePath="src/vim-ime.ts"
      />,
    )

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')

    act(() => {
      useAppStore.setState({ editorVimMode: true })
    })

    const vimPanel = await waitFor(() => {
      const el = container.querySelector('.cm-vim-panel')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })

    expect(vimPanel.textContent).toContain('--NORMAL--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')
    expect(view.contentDOM.getAttribute('tabindex')).toBe('0')

    view.focus()

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'v' })
    })
    expect(vimPanel.textContent).toContain('--VISUAL--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'Escape', keyCode: 27 })
      fireEvent.keyDown(view.contentDOM, { key: 'i' })
    })
    expect(vimPanel.textContent).toContain('--INSERT--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')

    act(() => {
      fireEvent.compositionStart(view.contentDOM, { data: 'bianji' })
      view.contentDOM.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Escape',
          keyCode: 229,
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      )
      fireEvent.compositionEnd(view.contentDOM, { data: '' })
    })
    expect(vimPanel.textContent).toContain('--INSERT--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')

    act(() => {
      fireEvent.compositionStart(view.contentDOM, { data: 'ceshi' })
      fireEvent.compositionEnd(view.contentDOM, { data: '' })
      fireEvent.keyDown(view.contentDOM, { key: 'Escape', keyCode: 27 })
    })
    expect(vimPanel.textContent).toContain('--INSERT--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: 'Escape', keyCode: 27 })
    })
    expect(vimPanel.textContent).toContain('--NORMAL--')
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false')

    act(() => {
      fireEvent.keyDown(view.contentDOM, { key: '/' })
    })
    const searchInput = container.querySelector('.cm-vim-panel input') as HTMLInputElement
    expect(searchInput).not.toBeNull()

    act(() => {
      fireEvent.compositionStart(searchInput, { data: 'bianjiqi' })
      searchInput.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          keyCode: 229,
          bubbles: true,
          cancelable: true,
          isComposing: true,
        }),
      )
      fireEvent.compositionEnd(searchInput, { data: '编辑器' })
    })
    expect(container.querySelector('.cm-vim-panel input')).toBe(searchInput)

    act(() => {
      searchInput.value = '编辑器测试'
      fireEvent.input(searchInput)
      fireEvent.keyDown(searchInput, { key: 'Enter', keyCode: 13 })
    })
    expect(container.querySelector('.cm-vim-panel input')).toBeNull()
    expect(view.state.doc.lineAt(view.state.selection.main.head).number).toBe(2)

    act(() => {
      useAppStore.setState({ editorVimMode: false })
    })
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('true')
  })

  it('renders hybrid relative line numbers from settings and syncs with Vim :set rnu / :set nornu / :set rnu!', async () => {
    const sample = ['line 1', 'line 2', 'line 3', 'line 4', 'line 5'].join('\n')

    const { container } = render(
      <CodeFileEditor
        content={sample}
        diskContent={sample}
        gitDiff=""
        filePath="src/relative-lines.ts"
      />,
    )

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!

    expect(readVisibleGutterNumbers(container)).toEqual(['1', '2', '3', '4', '5'])

    act(() => {
      useAppStore.setState({ editorRelativeLineNumbers: true })
    })
    expect(readVisibleGutterNumbers(container)).toEqual(['1', '1', '2', '3', '4'])

    act(() => {
      view.dispatch({ selection: { anchor: view.state.doc.line(3).from } })
    })
    expect(readVisibleGutterNumbers(container)).toEqual(['2', '1', '3', '1', '2'])

    act(() => {
      useAppStore.setState({ editorVimMode: true })
    })
    await waitFor(() => {
      expect(container.querySelector('.cm-vim-panel')).not.toBeNull()
    })
    view.focus()

    const runExCommand = (cmd: string) => {
      act(() => {
        fireEvent.keyDown(view.contentDOM, { key: ':' })
      })
      const exInput = container.querySelector('.cm-vim-panel input') as HTMLInputElement
      expect(exInput).not.toBeNull()
      act(() => {
        exInput.value = cmd
        fireEvent.input(exInput)
        fireEvent.keyDown(exInput, { key: 'Enter', keyCode: 13 })
      })
    }

    runExCommand('set nornu')
    expect(useAppStore.getState().editorRelativeLineNumbers).toBe(false)
    expect(saveAppSettings).toHaveBeenCalledWith({ editorRelativeLineNumbers: false })
    expect(readVisibleGutterNumbers(container)).toEqual(['1', '2', '3', '4', '5'])

    runExCommand('set rnu')
    expect(useAppStore.getState().editorRelativeLineNumbers).toBe(true)
    expect(saveAppSettings).toHaveBeenCalledWith({ editorRelativeLineNumbers: true })
    expect(readVisibleGutterNumbers(container)).toEqual(['2', '1', '3', '1', '2'])

    runExCommand('set rnu!')
    expect(useAppStore.getState().editorRelativeLineNumbers).toBe(false)
    expect(readVisibleGutterNumbers(container)).toEqual(['1', '2', '3', '4', '5'])
  })
})

/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { createTwoFilesPatch } from 'diff'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodeCommentNoteHost } from '@/components/chat/CodeCommentNoteHost'
import { closeCodeCommentNote } from '@/components/chat/code-comment-note'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat-store'
import { buildReplyCommentsText } from '@/stores/chat-store/helpers/reply-comments'
import { CodeFileEditor } from './CodeFileEditor'

describe('CodeFileEditor', () => {
  const saveFile = vi.fn(() => Promise.resolve({ ok: true }))

  beforeEach(() => {
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} } as DOMRectList)
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
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      saveFile,
      onContentZoom: () => () => {},
      setUnsavedEditorBuffer: vi.fn(() => Promise.resolve()),
      trace: () => {},
    }
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('displays only current file lines while rendering added, modified, and deleted markers in the gutter', async () => {
    const base = 'const keep1 = 1\nconst oldVal = 10\nconst keep2 = 2\nconst removedLine = 99\nconst keep3 = 3\n'
    const current = 'const keep1 = 1\nconst newVal = 20\nconst keep2 = 2\nconst keep3 = 3\nconst addedLine = 42\n'
    const gitDiff = createTwoFilesPatch('a/app.ts', 'b/app.ts', base, current)

    const { container } = render(
      <CodeFileEditor
        content={current}
        diskContent={current}
        gitDiff={gitDiff}
        filePath="src/app.ts"
      />,
    )

    await waitFor(() => {
      expect(container.querySelector('[data-diff-marker="modified"][data-diff-line="2"]')).not.toBeNull()
    })

    expect(container.querySelector('.cm-content')?.textContent).toContain('const newVal = 20')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('const oldVal = 10')
    expect(container.querySelector('.cm-content')?.textContent).not.toContain('const removedLine = 99')

    expect(container.querySelector('[data-diff-marker="deleted"][data-diff-line="3"]')).not.toBeNull()
    expect(container.querySelector('[data-diff-marker="added"][data-diff-line="5"]')).not.toBeNull()
  })

  it('opens the diff hover card on gutter hover and reverts the change when Revert Change is clicked', async () => {
    const base = 'const a = 1\nconst b = 2\n'
    const current = 'const a = 1\nconst b = 999\n'
    const gitDiff = createTwoFilesPatch('a/app.ts', 'b/app.ts', base, current)
    const onSaved = vi.fn()

    const { container } = render(
      <CodeFileEditor
        content={current}
        diskContent={current}
        gitDiff={gitDiff}
        filePath="src/app.ts"
        onSaved={onSaved}
      />,
    )

    const marker = await waitFor(() => {
      const el = container.querySelector('[data-diff-marker="modified"][data-diff-line="2"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })

    fireEvent.mouseOver(marker)
    const card = await screen.findByTestId('diff-hunk-hover-card')
    expect(card).toHaveTextContent('const b = 2')
    expect(card).toHaveTextContent('const b = 999')
    const revert = screen.getByTestId('diff-hunk-revert')
    expect(revert).toHaveAttribute('aria-label', 'Revert Change')
    expect(revert.textContent ?? '').not.toMatch(/\S/)
    expect(screen.getByTestId('diff-hunk-add-comment')).toHaveAttribute('aria-label', 'Add Comment')

    await act(async () => {
      fireEvent.click(screen.getByTestId('diff-hunk-revert'))
    })

    await waitFor(() => {
      expect(saveFile).toHaveBeenCalledWith('/proj', 'src/app.ts', 'const a = 1\nconst b = 2\n')
    })
    expect(onSaved).toHaveBeenCalledWith('const a = 1\nconst b = 2\n')
    expect(container.querySelector('.cm-content')?.textContent).toContain('const b = 2')
    expect(container.querySelector('[data-diff-marker="modified"]')).toBeNull()
  })

  it('adds the hovered hunk to the chat composer', async () => {
    const previous = useChatStore.getState().addUserSelection
    const addUserSelection = vi.fn()
    useChatStore.setState({ addUserSelection })
    const base = 'const a = 1\nconst b = 2\n'
    const current = 'const a = 1\nconst b = 999\n'
    const gitDiff = createTwoFilesPatch('a/app.ts', 'b/app.ts', base, current)

    try {
      const { container } = render(
        <CodeFileEditor
          content={current}
          diskContent={current}
          gitDiff={gitDiff}
          filePath="src/app.ts"
        />,
      )

      const marker = await waitFor(() => {
        const el = container.querySelector('[data-diff-marker="modified"][data-diff-line="2"]')
        expect(el).not.toBeNull()
        return el as HTMLElement
      })
      fireEvent.mouseOver(marker)
      await screen.findByTestId('diff-hunk-hover-card')
      fireEvent.click(screen.getByTestId('diff-hunk-add-to-chat'))

      expect(addUserSelection).toHaveBeenCalledWith('/proj/src/app.ts:L2:D\n-const b = 2\n+const b = 999')
    } finally {
      useChatStore.setState({ addUserSelection: previous })
    }
  })

  it('quotes a manual selection with the diff when the lines are changed, and comments share the transcript sequence', async () => {
    const previous = {
      activeProject: useChatStore.getState().activeProject,
      projectSessions: useChatStore.getState().projectSessions,
    }
    useChatStore.setState({
      activeProject: '/proj',
      projectSessions: {
        '/proj': {
          ...createDefaultProjectState(),
          _activeSessionId: 's1',
          _sessions: {
            s1: {
              ...createDefaultPerSessionState(),
              replyComments: [{
                id: 'c-chat',
                messageId: 'm1',
                anchorText: 'a passage',
                quote: 'a passage',
                text: 'from chat',
              }],
            },
          },
        },
      },
    })

    const base = 'const a = 1\nconst b = 2\n'
    const current = 'const a = 1\nconst b = 999\n'
    const gitDiff = createTwoFilesPatch('a/app.ts', 'b/app.ts', base, current)
    const { container } = render(
      <>
        <CodeCommentNoteHost />
        <CodeFileEditor content={current} diskContent={current} gitDiff={gitDiff} filePath="src/app.ts" />
      </>,
    )

    try {
      await waitFor(() => {
        expect(container.querySelector('[data-diff-marker="modified"][data-diff-line="2"]')).not.toBeNull()
      })
      const cmDom = container.querySelector('.cm-editor') as HTMLElement
      const view = EditorView.findFromDOM(cmDom)!
      const unchanged = view.state.doc.line(1)
      const changed = view.state.doc.line(2)

      act(() => {
        view.dispatch({ selection: { anchor: unchanged.from, head: unchanged.to } })
      })
      fireEvent.contextMenu(view.contentDOM)
      fireEvent.click(screen.getByText('Add to Chat'))
      expect(useChatStore.getState().projectSessions['/proj']._sessions.s1.userSelections).toEqual([
        '/proj/src/app.ts:L1:C0-C11\nconst a = 1',
      ])

      act(() => {
        view.dispatch({ selection: { anchor: changed.from, head: changed.to } })
      })
      fireEvent.contextMenu(view.contentDOM)
      fireEvent.click(screen.getByText('Add Comment'))
      const input = await screen.findByTestId('code-comment-note').then((note) => note.querySelector('textarea')!)
      fireEvent.change(input, { target: { value: 'keep the old default' } })
      fireEvent.blur(input)

      const comments = useChatStore.getState().projectSessions['/proj']._sessions.s1.replyComments
      expect(comments.map((comment) => comment.text)).toEqual(['from chat', 'keep the old default'])
      expect(comments[1]).toMatchObject({
        surface: 'code',
        quote: '/proj/src/app.ts:L2:C0-C13:D\n-const b = 2\n+const b = 999',
      })
      const injected = buildReplyCommentsText(comments)
      expect(injected).toContain('1. On this passage:\n> a passage\nComment: from chat')
      expect(injected).toContain('2. On this passage:\n> /proj/src/app.ts:L2:C0-C13:D\n> -const b = 2\n> +const b = 999\nComment: keep the old default')
      await waitFor(() => {
        const pin = container.querySelector('[data-testid="code-comment-layer"] button')
        expect(pin?.textContent).toBe('2')
        const strokes = container.querySelector('[data-testid="code-comment-strokes"]')
        expect(strokes?.closest('.cm-scroller')).not.toBeNull()
        expect(strokes?.closest('[data-testid="code-comment-layer"]')).toBeNull()
      })
    } finally {
      act(() => closeCodeCommentNote())
      useChatStore.setState(previous)
    }
  })

  it('tracks live edits with live diff markers, dirty state, and debounced autosave', async () => {
    vi.useFakeTimers()
    const initial = 'const x = 1\nconst y = 2\n'
    const onDirtyChange = vi.fn()

    const { container } = render(
      <CodeFileEditor
        content={initial}
        diskContent={initial}
        gitDiff=""
        filePath="src/live.ts"
        onDirtyChange={onDirtyChange}
      />,
    )

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!
    expect(view).not.toBeNull()

    act(() => {
      view.dispatch({
        changes: { from: 0, to: 'const x = 1'.length, insert: 'const x = 42' },
      })
    })

    expect(screen.getByTestId('code-file-editor')).toHaveAttribute('data-dirty', 'true')
    expect(onDirtyChange).toHaveBeenCalledWith(true)
    expect(container.querySelector('[data-diff-marker="modified"][data-diff-line="1"]')).not.toBeNull()
    expect(saveFile).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1050)
    })

    expect(saveFile).toHaveBeenCalledWith('/proj', 'src/live.ts', 'const x = 42\nconst y = 2\n')
    expect(screen.getByTestId('code-file-editor')).toHaveAttribute('data-dirty', 'false')
  })

  it('saves immediately on Mod+S before the autosave timer elapses', async () => {
    vi.useFakeTimers()
    const initial = 'export const port = 3000\n'

    const { container } = render(
      <CodeFileEditor
        content={initial}
        diskContent={initial}
        gitDiff=""
        filePath="src/config.ts"
      />,
    )

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!

    act(() => {
      view.dispatch({
        changes: { from: 0, to: initial.length, insert: 'export const port = 8080\n' },
      })
    })

    expect(saveFile).not.toHaveBeenCalled()

    await act(async () => {
      fireEvent.keyDown(view.contentDOM, { key: 's', ctrlKey: true })
    })

    expect(saveFile).toHaveBeenCalledWith('/proj', 'src/config.ts', 'export const port = 8080\n')
  })

  it('renders CodeMinimap only when content overflows one page and keeps gutter background transparent', async () => {
    const content = Array.from({ length: 80 }, (_, i) => `const line_${i} = ${i}`).join('\n') + '\n'
    const { container } = render(
      <CodeFileEditor
        content={content}
        diskContent={content}
        gitDiff=""
        filePath="src/long.ts"
      />,
    )

    expect(screen.queryByTestId('code-minimap')).toBeNull()

    const gutters = container.querySelector('.cm-gutters') as HTMLElement
    expect(window.getComputedStyle(gutters).backgroundColor).toBe('rgba(0, 0, 0, 0)')

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!
    Object.defineProperty(view.scrollDOM, 'scrollHeight', { value: 1600, configurable: true })
    Object.defineProperty(view.scrollDOM, 'clientHeight', { value: 400, configurable: true })

    act(() => {
      view.dispatch({ changes: { from: content.length, to: content.length, insert: '\n' } })
    })

    const minimap = await screen.findByTestId('code-minimap')
    expect(minimap).toBeInTheDocument()
    expect(cmDom).toHaveAttribute('data-has-minimap', 'true')
    expect(minimap.parentElement).toBe(cmDom)

    act(() => {
      openSearchPanel(view)
      useAppStore.setState({ editorVimMode: true })
    })

    const topPanels = await waitFor(() => {
      const el = cmDom.querySelector(':scope > .cm-panels-top')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })
    const bottomPanels = await waitFor(() => {
      const el = cmDom.querySelector(':scope > .cm-panels-bottom')
      expect(el).not.toBeNull()
      return el as HTMLElement
    })

    expect(window.getComputedStyle(cmDom).display).toBe('grid')
    expect(window.getComputedStyle(topPanels).gridColumn).toBe('1 / -1')
    expect(window.getComputedStyle(bottomPanels).gridColumn).toBe('1 / -1')
    expect(window.getComputedStyle(minimap).gridColumn).toBe('2')
    expect(window.getComputedStyle(minimap).gridRow).toBe('2')
  })

  it('syntax-highlights very long files (>10k lines) both at the top and after jumping to the bottom', async () => {
    const longContent = Array.from(
      { length: 15000 },
      (_, i) => `export const entry_${i + 1}: number = ${i + 1}`,
    ).join('\n') + '\n'

    const { container } = render(
      <CodeFileEditor
        content={longContent}
        diskContent={longContent}
        gitDiff=""
        filePath="src/huge.ts"
      />,
    )

    await waitFor(() => {
      const colored = container.querySelectorAll('.cm-line span[style*="color:"]')
      expect(colored.length).toBeGreaterThan(0)
    })

    const cmDom = container.querySelector('.cm-editor') as HTMLElement
    const view = EditorView.findFromDOM(cmDom)!
    const bottomPos = view.state.doc.line(14950).from

    act(() => {
      view.dispatch({
        selection: { anchor: bottomPos },
        effects: EditorView.scrollIntoView(bottomPos, { y: 'center' }),
      })
    })

    await waitFor(() => {
      const colored = container.querySelectorAll('.cm-line span[style*="color:"]')
      expect(colored.length).toBeGreaterThan(0)
    })
  })
})

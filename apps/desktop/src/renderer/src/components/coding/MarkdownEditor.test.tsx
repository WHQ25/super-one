/** @vitest-environment jsdom */

import { act, render, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'

const captured = vi.hoisted(() => ({ editor: null as Editor | null }))
const codec = vi.hoisted(() => ({
  docToMarkdown: vi.fn((ed: Editor) => ed.getText()),
  markdownToDoc: vi.fn((md: string) =>
    Promise.resolve({
      type: 'doc',
      content: [{ type: 'paragraph', ...(md ? { content: [{ type: 'text', text: md }] } : {}) }],
    }),
  ),
}))

// Keep the real tiptap editor (the bug lives in how the doc is rebuilt) but
// grab the instance so the test can drive real transactions.
vi.mock('@tiptap/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tiptap/react')>()
  return {
    ...actual,
    useEditor: (...args: Parameters<typeof actual.useEditor>) => {
      const editor = actual.useEditor(...args)
      captured.editor = editor as Editor | null
      return editor
    },
  }
})
vi.mock('./markdown-codec', () => codec)
vi.mock('./extensions/code-block-view', async () => {
  const { Node } = await import('@tiptap/core')
  return { CodeBlock: Node.create({ name: 'codeBlock', group: 'block', code: true, content: 'text*' }) }
})
vi.mock('./extensions/mermaid-node', async () => {
  const { Node } = await import('@tiptap/core')
  return { MermaidNode: Node.create({ name: 'mermaid', group: 'block', atom: true }) }
})
vi.mock('./extensions/slash-command', async () => {
  const { Extension } = await import('@tiptap/core')
  return { SlashCommand: Extension.create({ name: 'slashCommand' }) }
})
vi.mock('./extensions/math', () => ({ createMathExtensions: () => [] }))
vi.mock('./extensions/MathEditDialog', () => ({ MathEditDialog: () => null }))
vi.mock('./extensions/TableContextMenu', () => ({ TableContextMenu: () => null, TABLE_MENU_ENTRIES: [] }))
vi.mock('@/components/chat/LinkSafetyModal', () => ({ LinkSafetyModal: () => null }))

const { MarkdownEditor } = await import('./MarkdownEditor')

function stubWindowApp() {
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = { saveFile: vi.fn(() => Promise.resolve({ ok: true })) }
}

describe('MarkdownEditor draft echo', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: '/proj' })
    stubWindowApp()
    captured.editor = null
    codec.markdownToDoc.mockClear()
  })
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the caret in place when the parent echoes the draft back', async () => {
    const onContentChange = vi.fn()
    const { rerender } = render(
      <MarkdownEditor content="hello" filePath="docs/readme.md" onDirtyChange={() => {}} onContentChange={onContentChange} />,
    )
    await waitFor(() => expect(captured.editor?.getText()).toBe('hello'))
    expect(codec.markdownToDoc).toHaveBeenCalledTimes(1)

    const editor = captured.editor!
    act(() => {
      editor.commands.setTextSelection(1)
      editor.commands.insertContent('X')
    })
    const typed = onContentChange.mock.calls.at(-1)![0] as string
    expect(typed).toBe('Xhello')
    const caret = editor.state.selection.from

    // The parent publishes the draft back as `content`.
    rerender(
      <MarkdownEditor content={typed} filePath="docs/readme.md" onDirtyChange={() => {}} onContentChange={onContentChange} />,
    )
    await act(async () => { await Promise.resolve() })

    expect(codec.markdownToDoc).toHaveBeenCalledTimes(1)
    expect(editor.state.selection.from).toBe(caret)
    expect(editor.getText()).toBe('Xhello')
  })

  it('still reloads when the content genuinely changes outside the editor', async () => {
    const { rerender } = render(
      <MarkdownEditor content="hello" filePath="docs/readme.md" onDirtyChange={() => {}} onContentChange={() => {}} />,
    )
    await waitFor(() => expect(captured.editor?.getText()).toBe('hello'))

    rerender(
      <MarkdownEditor content="from disk" filePath="docs/readme.md" onDirtyChange={() => {}} onContentChange={() => {}} />,
    )
    await waitFor(() => expect(captured.editor?.getText()).toBe('from disk'))
    expect(codec.markdownToDoc).toHaveBeenCalledTimes(2)
  })
})

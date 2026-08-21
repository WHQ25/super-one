/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { FilePreview } from './FilePreview'

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
}))
vi.mock('./TextFileEditor', () => ({
  TextFileEditor: () => <div data-testid="text-file-editor" />,
}))
vi.mock('./source-control/FileWithDiffView', () => ({
  FileWithDiffView: () => <div data-testid="file-view" />,
}))
vi.mock('./source-control/FileDiffView', () => ({
  FileDiffView: () => <div data-testid="diff-view" />,
}))

interface FakeFile {
  language: string
  content: string
  diff: string
}

function stubFile({ language, content, diff }: FakeFile) {
  const w = globalThis.window as unknown as Record<string, unknown>
  w.app = {
    getGitDiffFile: () => Promise.resolve({ path: 'f', diff }),
    readProjectFile: () => Promise.resolve({ path: 'f', content, language }),
    onContentZoom: () => () => {},
    setUnsavedEditorBuffer: vi.fn(() => Promise.resolve()),
    saveFile: vi.fn(() => Promise.resolve({ ok: true })),
  }
}

function tabLabels(): string[] {
  return Array.from(document.querySelectorAll('[role="tab"]')).map((el) => el.textContent ?? '')
}

describe('FilePreview tab derivation', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: '/proj' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows Preview + File for markdown, defaulting to Preview (editable WYSIWYG)', async () => {
    stubFile({ language: 'markdown', content: '# hi', diff: '' })
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Preview', 'File'])
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('data-state', 'inactive')
    expect(screen.queryByRole('tab', { name: 'Editor' })).not.toBeInTheDocument()
  })


  it('shows Editor + File for non-markdown text, defaulting to the File view', async () => {
    stubFile({ language: 'typescript', content: 'const a = 1', diff: '' })
    render(<FilePreview filePath="src/app.ts" />)
    await waitFor(() => expect(screen.getByTestId('file-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Editor', 'File'])
    expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByRole('tab', { name: 'Editor' })).toHaveAttribute('data-state', 'inactive')
  })

  it('adds Changes + Editor + File when a non-markdown file has a diff', async () => {
    stubFile({ language: 'typescript', content: 'const a = 2', diff: '@@ -1 +1 @@\n-const a = 1\n+const a = 2' })
    render(<FilePreview filePath="src/app.ts" />)
    await waitFor(() => expect(screen.getByTestId('diff-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Changes', 'Editor', 'File'])
  })

  it('exposes Changes, Preview and File for a markdown file with a diff (default Preview)', async () => {
    stubFile({ language: 'markdown', content: '# v2', diff: '@@ -1 +1 @@\n-# v1\n+# v2' })
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Changes', 'Preview', 'File'])
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('data-state', 'active')
  })

  it('shows Preview + File for a notebook, defaulting to the rendered cells', async () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      metadata: { language_info: { name: 'python' } },
      cells: [
        { cell_type: 'markdown', source: '# Analysis\n' },
        {
          cell_type: 'code',
          execution_count: 1,
          source: 'print("hi")',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'hi\n' }],
        },
      ],
    })
    stubFile({ language: 'json', content: notebook, diff: '' })
    render(<FilePreview filePath="notebooks/analysis.ipynb" />)
    await waitFor(() => expect(screen.getByText('In [1]:')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Preview', 'File'])
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tab', { name: 'Editor' })).not.toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
  })

  it('falls back to a hint instead of blank output when a .ipynb is not parseable', async () => {
    stubFile({ language: 'json', content: '{ broken', diff: '' })
    render(<FilePreview filePath="notebooks/broken.ipynb" />)
    await waitFor(() => expect(screen.getByText(/Not a valid notebook/)).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Preview', 'File'])
  })

  it('shows Editor + File for HTML (no in-editor Preview tab)', async () => {
    stubFile({ language: 'html', content: '<html><body>hi</body></html>', diff: '' })
    render(<FilePreview filePath="index.html" />)
    await waitFor(() => expect(screen.getByTestId('file-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Editor', 'File'])
    expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tab', { name: 'Preview' })).not.toBeInTheDocument()
  })
})

describe('FilePreview read failures', () => {
  beforeEach(() => {
    useAppStore.setState({ currentFolder: '/proj' })
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the error and hides tabs instead of rendering a blank editor', async () => {
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      getGitDiffFile: () => Promise.resolve({ path: 'f', diff: '' }),
      readProjectFile: () => Promise.resolve({ path: 'f', content: '', language: 'text', error: 'ENOENT: no such file' }),
      onContentZoom: () => () => {},
      setUnsavedEditorBuffer: vi.fn(() => Promise.resolve()),
      saveFile: vi.fn(() => Promise.resolve({ ok: true })),
    }
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByText('Could not read this file')).toBeInTheDocument())
    expect(screen.getByText('ENOENT: no such file')).toBeInTheDocument()
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument()
    expect(tabLabels()).toEqual([])
  })

  it('re-reads on Retry and derives the markdown default tab from the fresh read', async () => {
    const readProjectFile = vi.fn()
      .mockResolvedValueOnce({ path: 'f', content: '', language: 'text', error: 'remote node unreachable' })
      .mockResolvedValue({ path: 'f', content: '# hi', language: 'markdown' })
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      getGitDiffFile: () => Promise.resolve({ path: 'f', diff: '' }),
      readProjectFile,
      onContentZoom: () => () => {},
      setUnsavedEditorBuffer: vi.fn(() => Promise.resolve()),
      saveFile: vi.fn(() => Promise.resolve({ ok: true })),
    }
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Retry/ }))

    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toBeInTheDocument())
    expect(readProjectFile).toHaveBeenCalledTimes(2)
    expect(tabLabels()).toEqual(['Preview', 'File'])
    expect(screen.getByRole('tab', { name: 'Preview' })).toHaveAttribute('data-state', 'active')
  })
})

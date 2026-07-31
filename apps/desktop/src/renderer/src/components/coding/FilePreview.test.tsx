/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
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

  it('shows Editor + File for HTML (no in-editor Preview tab)', async () => {
    stubFile({ language: 'html', content: '<html><body>hi</body></html>', diff: '' })
    render(<FilePreview filePath="index.html" />)
    await waitFor(() => expect(screen.getByTestId('file-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Editor', 'File'])
    expect(screen.getByRole('tab', { name: 'File' })).toHaveAttribute('data-state', 'active')
    expect(screen.queryByRole('tab', { name: 'Preview' })).not.toBeInTheDocument()
  })
})

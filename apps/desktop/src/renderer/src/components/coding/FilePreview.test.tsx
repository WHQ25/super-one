/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/stores/app'
import { FilePreview } from './FilePreview'

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: () => <div data-testid="markdown-editor" />,
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

  it('shows Editor + File tabs for markdown, defaulting to the WYSIWYG editor', async () => {
    stubFile({ language: 'markdown', content: '# hi', diff: '' })
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByTestId('markdown-editor')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Editor', 'File'])
  })

  it('labels the non-markdown tab File (not Editor) and renders the read-only view', async () => {
    stubFile({ language: 'typescript', content: 'const a = 1', diff: '' })
    render(<FilePreview filePath="src/app.ts" />)
    await waitFor(() => expect(screen.getByTestId('file-view')).toBeInTheDocument())
    expect(screen.queryByText('Editor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('markdown-editor')).not.toBeInTheDocument()
  })

  it('adds a Changes tab and defaults to it when a non-markdown file has a diff, still no Editor', async () => {
    stubFile({ language: 'typescript', content: 'const a = 2', diff: '@@ -1 +1 @@\n-const a = 1\n+const a = 2' })
    render(<FilePreview filePath="src/app.ts" />)
    await waitFor(() => expect(screen.getByTestId('diff-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Changes', 'File'])
  })

  it('exposes Changes, Editor and File for a markdown file with a diff', async () => {
    stubFile({ language: 'markdown', content: '# v2', diff: '@@ -1 +1 @@\n-# v1\n+# v2' })
    render(<FilePreview filePath="docs/readme.md" />)
    await waitFor(() => expect(screen.getByTestId('diff-view')).toBeInTheDocument())
    expect(tabLabels()).toEqual(['Changes', 'Editor', 'File'])
  })
})

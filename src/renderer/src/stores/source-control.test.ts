import { describe, it, expect, vi, beforeEach } from 'vitest'

let resolveDiff: (v: { diff: string }) => void
let resolveContent: (v: { content: string }) => void

const mockGetGitStatusFiles = vi.fn().mockResolvedValue([])
const mockGetGitDiffFile = vi.fn(() => new Promise<{ diff: string }>((r) => { resolveDiff = r }))
const mockGetGitReadFile = vi.fn(() => new Promise<{ content: string }>((r) => { resolveContent = r }))

vi.stubGlobal('window', {
  app: {
    getGitStatusFiles: mockGetGitStatusFiles,
    getGitDiffFile: mockGetGitDiffFile,
    getGitReadFile: mockGetGitReadFile,
  },
})

const { useSourceControlStore } = await import('./source-control')
const store = useSourceControlStore

function resetStore(overrides: Record<string, unknown> = {}) {
  store.setState({
    files: [],
    loading: false,
    selectedFile: null,
    fileDiff: null,
    fileContent: null,
    diffLoading: false,
    activeTab: 'changes',
    ...overrides,
  })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockGetGitDiffFile.mockImplementation(() => new Promise<{ diff: string }>((r) => { resolveDiff = r }))
  mockGetGitReadFile.mockImplementation(() => new Promise<{ content: string }>((r) => { resolveContent = r }))
})

describe('selectFile', () => {
  it('should set diffLoading and clear content for a new file', async () => {
    const promise = store.getState().selectFile('/project', 'src/index.ts')
    expect(store.getState().selectedFile).toBe('src/index.ts')
    expect(store.getState().diffLoading).toBe(true)
    expect(store.getState().fileDiff).toBeNull()
    expect(store.getState().fileContent).toBeNull()

    resolveDiff({ diff: '' })
    resolveContent({ content: 'code' })
    await promise

    expect(store.getState().diffLoading).toBe(false)
    expect(store.getState().fileContent).toEqual({ content: 'code' })
  })

  it('should NOT set diffLoading when refreshing the same file', async () => {
    resetStore({
      selectedFile: 'src/index.ts',
      fileDiff: { diff: 'old-diff' },
      fileContent: { content: 'old-content' },
      diffLoading: false,
    })

    const promise = store.getState().selectFile('/project', 'src/index.ts')
    expect(store.getState().diffLoading).toBe(false)
    expect(store.getState().fileContent).toEqual({ content: 'old-content' })
    expect(store.getState().fileDiff).toEqual({ diff: 'old-diff' })

    resolveDiff({ diff: 'new-diff' })
    resolveContent({ content: 'new-content' })
    await promise

    expect(store.getState().fileContent).toEqual({ content: 'new-content' })
    expect(store.getState().fileDiff).toEqual({ diff: 'new-diff' })
  })

  it('should discard stale response when selectedFile changed during fetch', async () => {
    const promiseA = store.getState().selectFile('/project', 'a.ts')
    const resolveDiffA = resolveDiff
    const resolveContentA = resolveContent

    const promiseB = store.getState().selectFile('/project', 'b.ts')
    expect(store.getState().selectedFile).toBe('b.ts')

    resolveDiff({ diff: '' })
    resolveContent({ content: 'content-b' })
    await promiseB

    expect(store.getState().fileContent).toEqual({ content: 'content-b' })

    resolveDiffA({ diff: 'stale-diff' })
    resolveContentA({ content: 'stale-content' })
    await promiseA

    expect(store.getState().selectedFile).toBe('b.ts')
    expect(store.getState().fileContent).toEqual({ content: 'content-b' })
  })

  it('should default to preview tab for markdown files', async () => {
    const promise = store.getState().selectFile('/project', 'README.md')
    resolveDiff({ diff: '' })
    resolveContent({ content: '# Hello' })
    await promise

    expect(store.getState().activeTab).toBe('preview')
  })

  it('should default to preview tab for .mdx files', async () => {
    const promise = store.getState().selectFile('/project', 'doc.mdx')
    resolveDiff({ diff: '' })
    resolveContent({ content: '# Hello' })
    await promise

    expect(store.getState().activeTab).toBe('preview')
  })

  it('should default to changes tab when diff exists even for markdown', async () => {
    const promise = store.getState().selectFile('/project', 'README.md')
    resolveDiff({ diff: '+ added line' })
    resolveContent({ content: '# Hello' })
    await promise

    expect(store.getState().activeTab).toBe('changes')
  })

  it('should default to file tab for non-markdown without diff', async () => {
    const promise = store.getState().selectFile('/project', 'src/app.ts')
    resolveDiff({ diff: '' })
    resolveContent({ content: 'code' })
    await promise

    expect(store.getState().activeTab).toBe('file')
  })
})

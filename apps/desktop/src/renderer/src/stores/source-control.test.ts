import { describe, it, expect, vi, beforeEach } from 'vitest'

let resolveDiff: (v: { diff: string }) => void
let resolveContent: (v: { content: string }) => void

const mockGetGitStatusFiles = vi.fn().mockResolvedValue([])
const mockGetGitDiffFile = vi.fn(() => new Promise<{ diff: string }>((r) => { resolveDiff = r }))
const mockReadProjectFile = vi.fn(() => new Promise<{ content: string }>((r) => { resolveContent = r }))

vi.stubGlobal('window', {
  app: {
    getGitStatusFiles: mockGetGitStatusFiles,
    getGitDiffFile: mockGetGitDiffFile,
    readProjectFile: mockReadProjectFile,
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
    activeTab: 'changes',
    ...overrides,
  })
}

beforeEach(() => {
  resetStore()
  vi.clearAllMocks()
  mockGetGitDiffFile.mockImplementation(() => new Promise<{ diff: string }>((r) => { resolveDiff = r }))
  mockReadProjectFile.mockImplementation(() => new Promise<{ content: string }>((r) => { resolveContent = r }))
})

describe('selectFile', () => {
  it('should select file and load content', async () => {
    const promise = store.getState().selectFile('/project', 'src/index.ts')
    expect(store.getState().selectedFile).toBe('src/index.ts')

    resolveDiff({ diff: '' })
    resolveContent({ content: 'code' })
    await promise

    expect(store.getState().fileContent).toEqual({ content: 'code' })
  })

  it('should keep old content visible until new file loads', async () => {
    resetStore({
      selectedFile: 'src/old.ts',
      fileDiff: { diff: 'old-diff' },
      fileContent: { content: 'old-content' },
    })

    const promise = store.getState().selectFile('/project', 'src/new.ts')
    expect(store.getState().selectedFile).toBe('src/new.ts')
    expect(store.getState().fileContent).toEqual({ content: 'old-content' })

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

  it('should strip a colon line suffix before loading the file', async () => {
    const promise = store.getState().selectFile('/project', 'README.md:12')
    expect(store.getState().selectedFile).toBe('README.md')
    expect(store.getState().scrollToLine?.line).toBe(12)

    resolveDiff({ diff: '' })
    resolveContent({ content: '# Hello' })
    await promise

    expect(mockGetGitDiffFile).toHaveBeenCalledWith('/project', 'README.md', false)
    expect(mockReadProjectFile).toHaveBeenCalledWith('/project', 'README.md')
    expect(store.getState().activeTab).toBe('file')
  })
})

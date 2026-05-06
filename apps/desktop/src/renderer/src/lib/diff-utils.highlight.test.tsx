/** @vitest-environment jsdom */

import { renderHook, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const highlightSpy = vi.fn()
const createHighlighterSpy = vi.fn()
const codeToTokensBaseSpy = vi.fn()
const getLastGrammarStateSpy = vi.fn()

vi.mock('@/components/chat/chat-shared', () => ({
  codePlugin: {
    supportsLanguage: () => true,
    getThemes: () => ['github-light', 'github-dark'],
    highlight: highlightSpy,
  },
  codePluginLight: {
    supportsLanguage: () => true,
    getThemes: () => ['github-light', 'github-dark'],
    highlight: highlightSpy,
  },
}))

vi.mock('@/hooks/use-is-dark', () => ({
  useIsDark: () => false,
}))

vi.mock('shiki/engine/javascript', () => ({
  createJavaScriptRegexEngine: () => ({}),
}))

vi.mock('shiki', () => ({
  createHighlighter: createHighlighterSpy,
}))

const highlighter = {
  codeToTokensBase: codeToTokensBaseSpy,
  getLastGrammarState: getLastGrammarStateSpy,
  loadTheme: vi.fn().mockResolvedValue(undefined),
  loadLanguage: vi.fn().mockResolvedValue(undefined),
}

type IdleCallback = (deadline: IdleDeadline) => void

let idleId = 0
let idleQueue: Array<{ id: number; cb: IdleCallback }> = []

function flushNextIdle(): void {
  const next = idleQueue.shift()
  if (!next) return
  next.cb({
    didTimeout: false,
    timeRemaining: () => 50,
  } as IdleDeadline)
}

beforeEach(() => {
  vi.clearAllMocks()
  idleId = 0
  idleQueue = []
  createHighlighterSpy.mockResolvedValue(highlighter)
  codeToTokensBaseSpy.mockImplementation((code: string) =>
    code.split('\n').map((line: string) => [{ content: line }]),
  )
  getLastGrammarStateSpy.mockReturnValue(undefined)
  Object.defineProperty(window, 'requestIdleCallback', {
    configurable: true,
    value: vi.fn((cb: IdleCallback) => {
      const id = ++idleId
      idleQueue.push({ id, cb })
      return id
    }),
  })
  Object.defineProperty(window, 'cancelIdleCallback', {
    configurable: true,
    value: vi.fn((id: number) => {
      idleQueue = idleQueue.filter((item) => item.id !== id)
    }),
  })
  Object.defineProperty(globalThis, 'requestIdleCallback', {
    configurable: true,
    value: window.requestIdleCallback,
  })
  Object.defineProperty(globalThis, 'cancelIdleCallback', {
    configurable: true,
    value: window.cancelIdleCallback,
  })
})

describe('useHighlightedTokens', () => {
  it('uses the file highlighter directly and never calls the streamdown cache', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const { result } = renderHook(() => useHighlightedTokens('const a = 1', 'typescript'))

    await act(async () => {
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(highlightSpy).not.toHaveBeenCalled()
    expect(createHighlighterSpy).toHaveBeenCalled()
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)
  })

  it('returns cached tokens on repeat calls without invoking the highlighter again', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const { getHighlightCache, disposeHighlightCache } = await import('./highlight-cache')
    const projectPath = '/tmp/project-cache-hit'
    disposeHighlightCache(projectPath)
    const cache = getHighlightCache(projectPath)!

    const first = renderHook(() => useHighlightedTokens('const a = 1', 'typescript', { cache }))
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(first.result.current).not.toBeNull())
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)

    const second = renderHook(() => useHighlightedTokens('const a = 1', 'typescript', { cache }))
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(second.result.current).not.toBeNull())
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)
    expect(second.result.current).toBe(first.result.current)

    disposeHighlightCache(projectPath)
  })

  it('disposeHighlightCache forces the next call to rehighlight', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const { getHighlightCache, disposeHighlightCache } = await import('./highlight-cache')
    const projectPath = '/tmp/project-cache-dispose'
    disposeHighlightCache(projectPath)
    const cache = getHighlightCache(projectPath)!

    renderHook(() => useHighlightedTokens('const a = 1', 'typescript', { cache }))
    await act(async () => { await Promise.resolve() })
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)

    disposeHighlightCache(projectPath)
    const cache2 = getHighlightCache(projectPath)!

    renderHook(() => useHighlightedTokens('const a = 1', 'typescript', { cache: cache2 }))
    await act(async () => { await Promise.resolve() })
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(2)

    disposeHighlightCache(projectPath)
  })

  async function drainIdleQueue(): Promise<void> {
    while (idleQueue.length > 0) {
      flushNextIdle()
      await Promise.resolve()
      await Promise.resolve()
    }
  }

  it('writes cache entry after chunked path completes for long files', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const { getHighlightCache, disposeHighlightCache } = await import('./highlight-cache')
    const projectPath = '/tmp/project-cache-chunked'
    disposeHighlightCache(projectPath)
    const cache = getHighlightCache(projectPath)!
    const code = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n')

    renderHook(() => useHighlightedTokens(code, 'typescript', { cache }))
    await act(async () => { await drainIdleQueue() })
    const initialCalls = codeToTokensBaseSpy.mock.calls.length
    expect(initialCalls).toBeGreaterThan(1)
    expect(cache.size).toBe(1)

    const second = renderHook(() => useHighlightedTokens(code, 'typescript', { cache }))
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(second.result.current).not.toBeNull())
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(initialCalls)

    disposeHighlightCache(projectPath)
  })

  it('writes cache entry after chunked path completes for embedded-grammar files', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const { getHighlightCache, disposeHighlightCache } = await import('./highlight-cache')
    const projectPath = '/tmp/project-cache-html'
    disposeHighlightCache(projectPath)
    const cache = getHighlightCache(projectPath)!
    const code = '<html>\n<script>\nvar a = 1;\n</script>\n</html>'

    renderHook(() => useHighlightedTokens(code, 'html', { cache }))
    await act(async () => { await drainIdleQueue() })
    const initialCalls = codeToTokensBaseSpy.mock.calls.length
    expect(initialCalls).toBeGreaterThanOrEqual(1)
    expect(cache.size).toBe(1)

    const second = renderHook(() => useHighlightedTokens(code, 'html', { cache }))
    await act(async () => { await Promise.resolve() })
    await waitFor(() => expect(second.result.current).not.toBeNull())
    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(initialCalls)

    disposeHighlightCache(projectPath)
  })

  it('cancels queued chunk work on unmount', async () => {
    const { useHighlightedTokens } = await import('./diff-utils')
    const code = Array.from({ length: 250 }, (_, i) => `line ${i}`).join('\n')
    const { unmount } = renderHook(() => useHighlightedTokens(code, 'typescript'))

    await act(async () => {
      flushNextIdle()
      await Promise.resolve()
    })

    expect(idleQueue.length).toBeGreaterThan(0)
    unmount()
    expect(window.cancelIdleCallback).toHaveBeenCalled()
    expect(idleQueue).toHaveLength(0)
  })

  it('highlights only appended committed lines for incremental updates', async () => {
    const { useIncrementalHighlightedLines } = await import('./diff-utils')
    const { rerender, result } = renderHook(
      ({ lines }) => useIncrementalHighlightedLines(lines, 'typescript'),
      { initialProps: { lines: ['const a = 1'] } },
    )

    await act(async () => {
      flushNextIdle()
      await Promise.resolve()
    })

    await waitFor(() => expect(result.current).not.toBeNull())
    expect(codeToTokensBaseSpy).toHaveBeenLastCalledWith('const a = 1', expect.any(Object))

    rerender({ lines: ['const a = 1', 'const b = 2'] })

    await act(async () => {
      flushNextIdle()
      await Promise.resolve()
    })

    await waitFor(() => expect((result.current ?? []).length).toBe(2))
    expect(codeToTokensBaseSpy).toHaveBeenCalled()
  })

  it('tokenizes only the appended lines when content grows by append', async () => {
    const { useIncrementalHighlightedLines } = await import('./diff-utils')
    const baseLines = Array.from({ length: 40 }, (_, i) => `line ${i}`)
    const { rerender } = renderHook(
      ({ lines }) => useIncrementalHighlightedLines(lines, 'typescript'),
      { initialProps: { lines: [...baseLines] } },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    codeToTokensBaseSpy.mockClear()

    rerender({ lines: [...baseLines, 'line 40', 'line 41'] })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)
    expect(codeToTokensBaseSpy).toHaveBeenLastCalledWith(
      ['line 40', 'line 41'].join('\n'),
      expect.any(Object),
    )
  })

  it('full-tokenizes when a non-suffix change occurs', async () => {
    const { useIncrementalHighlightedLines } = await import('./diff-utils')
    const baseLines = Array.from({ length: 10 }, (_, i) => `line ${i}`)
    const { rerender } = renderHook(
      ({ lines }) => useIncrementalHighlightedLines(lines, 'typescript'),
      { initialProps: { lines: [...baseLines] } },
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    codeToTokensBaseSpy.mockClear()

    rerender({ lines: [...baseLines.slice(0, -1), 'line 9 updated'] })

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(codeToTokensBaseSpy).toHaveBeenCalledTimes(1)
    expect(codeToTokensBaseSpy).toHaveBeenLastCalledWith(
      [...baseLines.slice(0, -1), 'line 9 updated'].join('\n'),
      expect.any(Object),
    )
  })
})

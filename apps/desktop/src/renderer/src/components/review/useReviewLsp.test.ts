// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import type { DiffTokenEventBaseProps } from '@pierre/diffs'
import { useReviewLsp } from './useReviewLsp'

const mockQueryLspHover = vi.fn()
const mockQueryLspDefinition = vi.fn()
const mockResolveEnabledLspServer = vi.fn()
const mockAcquireVirtualFile = vi.fn(() => vi.fn())

vi.mock('@/lib/lsp-client-service', () => ({
  resolveEnabledLspServer: (...args: unknown[]) => mockResolveEnabledLspServer(...args),
  pathToFileUri: (p: string) => `file://${p}`,
  getOrCreateLspClientEntry: () => ({
    client: { serverCapabilities: { hoverProvider: true } },
    workspace: { acquireVirtualFile: mockAcquireVirtualFile },
  }),
  queryLspHover: (...args: unknown[]) => mockQueryLspHover(...args),
  queryLspDefinition: (...args: unknown[]) => mockQueryLspDefinition(...args),
}))

vi.mock('@/components/activity/activity-panel-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/activity/activity-panel-api')>()
  return {
    ...actual,
    openNewFileTab: vi.fn(),
  }
})

function createTokenProps(): DiffTokenEventBaseProps {
  const el = document.createElement('span')
  document.body.appendChild(el)
  el.getBoundingClientRect = () => ({
    left: 10,
    top: 20,
    right: 60,
    bottom: 36,
    width: 50,
    height: 16,
    x: 10,
    y: 20,
    toJSON: () => ({}),
  })
  return {
    side: 'additions',
    lineNumber: 3,
    lineCharStart: 4,
    lineCharEnd: 9,
    tokenText: 'hello',
    tokenElement: el,
  } as unknown as DiffTokenEventBaseProps
}

describe('useReviewLsp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockResolveEnabledLspServer.mockResolvedValue({ serverId: 'ts', languageId: 'typescript' })
    mockQueryLspHover.mockResolvedValue('const hello: string')
    mockQueryLspDefinition.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  async function mountReadyHook() {
    const rendered = renderHook(() =>
      useReviewLsp({
        workspaceRoot: '/repo',
        filePath: 'src/index.ts',
        diskContent: 'const hello = "world"',
        matchesDisk: true,
      }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(rendered.result.current.lspReady).toBe(true)
    return rendered
  }

  it('does not trigger hover card when hovering without Alt', async () => {
    const { result } = await mountReadyHook()
    const props = createTokenProps()

    act(() => {
      result.current.onTokenEnter(props, { altKey: false, ctrlKey: false, metaKey: false } as PointerEvent)
      vi.advanceTimersByTime(500)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockQueryLspHover).not.toHaveBeenCalled()
    expect(result.current.hoverCard).toBeNull()
  })

  it('triggers hover card when hovering with Alt held', async () => {
    const { result } = await mountReadyHook()
    const props = createTokenProps()

    act(() => {
      result.current.onTokenEnter(props, { altKey: true, ctrlKey: false, metaKey: false } as PointerEvent)
      vi.advanceTimersByTime(300)
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(mockQueryLspHover).toHaveBeenCalledTimes(1)
    expect(result.current.hoverCard?.markdown).toBe('const hello: string')
  })

  it('triggers hover card when pressing Alt while already hovering a token and dismisses on Escape', async () => {
    const { result } = await mountReadyHook()
    const props = createTokenProps()

    act(() => {
      result.current.onTokenEnter(props, { altKey: false, ctrlKey: false, metaKey: false } as PointerEvent)
    })
    expect(mockQueryLspHover).not.toHaveBeenCalled()

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Alt', altKey: true }))
      await Promise.resolve()
    })

    expect(mockQueryLspHover).toHaveBeenCalledTimes(1)
    expect(result.current.hoverCard?.markdown).toBe('const hello: string')

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(result.current.hoverCard).toBeNull()
  })
})

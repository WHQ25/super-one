/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat'
import { planHistoryEdges, scrollParent } from './remote-transcript-edges'
import { RemoteTranscriptChrome, RemoteTranscriptChromeView, RemoteTranscriptEdges } from './RemoteTranscriptChrome'

vi.mock('@/lib/remote-session-ops', () => ({
  pageRemoteTranscript: vi.fn(),
}))

const { pageRemoteTranscript } = await import('@/lib/remote-session-ops')

const PROJECT = 'remote:node-1:/work'
const SID = 's1'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.mocked(pageRemoteTranscript).mockReset()
  useChatStore.setState({ activeProject: null, projectSessions: {} })
})

function place(element: Element, top: number, bottom: number) {
  element.getBoundingClientRect = () => ({
    top, bottom, left: 0, right: 320, width: 320, height: bottom - top, x: 0, y: top, toJSON() { return {} },
  }) as DOMRect
}

describe('planHistoryEdges', () => {
  const root = { top: 0, bottom: 800 }

  it('loads the older page when that edge is within a screen of the scrollport', () => {
    expect(planHistoryEdges({
      root, top: { top: -40, bottom: -8 }, bottom: null,
      older: 'm0', newer: null, attempted: {},
    })).toEqual({ load: 'older', drop: [] })
  })

  it('does not load an edge more than a screen away', () => {
    expect(planHistoryEdges({
      root, top: { top: -2000, bottom: -1900 }, bottom: null,
      older: 'm0', newer: null, attempted: {},
    })).toEqual({ load: null, drop: ['older', 'newer'] })
  })

  it('loads one edge of a short window, older first, and skips a page already attempted', () => {
    const short = {
      root, top: { top: 0, bottom: 8 }, bottom: { top: 700, bottom: 708 },
      older: 'm0', newer: 'm9', attempted: {},
    }
    expect(planHistoryEdges(short)).toEqual({ load: 'older', drop: [] })
    expect(planHistoryEdges({ ...short, attempted: { older: 'm0' } })).toEqual({ load: 'newer', drop: [] })
  })

  it('finds a scroll area that has not overflowed yet', () => {
    const viewport = document.createElement('div')
    viewport.dataset.slot = 'scroll-area-viewport'
    viewport.style.overflowY = 'hidden'
    const edge = document.createElement('div')
    viewport.append(edge)
    document.body.append(viewport)
    expect(scrollParent(edge)).toBe(viewport)
    viewport.remove()
  })

  it('drops an attempt once its edge leaves, so the next visit retries', () => {
    expect(planHistoryEdges({
      root, top: { top: -2000, bottom: -1900 }, bottom: null,
      older: 'm0', newer: null, attempted: { older: 'm0' },
    }).drop).toEqual(['older', 'newer'])
  })
})

describe('RemoteTranscriptChromeView', () => {
  it('keeps a silent sentinel and no earlier button while history remains', () => {
    const { container } = render(<RemoteTranscriptChromeView hasMore />)
    expect(screen.queryByText('Longer messages are summarized until expanded.')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('[data-testid="remote-transcript-chrome-top"]')).not.toBeNull()
  })

  it('shows only the phone loader while a page is in flight', () => {
    render(<RemoteTranscriptChromeView loading hasMore />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText('Loading history…')).toBeNull()
    expect(screen.queryByText('Longer messages are summarized until expanded.')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('uses that same loader while the transcript is refreshing', () => {
    render(<RemoteTranscriptChromeView loading />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText('Refreshing transcript…')).toBeNull()
  })

  it('offers no newer button at the bottom of a detached window', () => {
    const { container } = render(<RemoteTranscriptChromeView edge="bottom" hasMore />)
    expect(screen.queryByRole('button', { name: 'Load Newer' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(container.querySelector('[data-testid="remote-transcript-chrome-bottom"]')).not.toBeNull()
  })

  it('renders nothing when the transcript is the whole session', () => {
    const { container } = render(<RemoteTranscriptChromeView />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('remote transcript autoload', () => {
  function observers() {
    const opened: Array<{ callback: () => void; init?: IntersectionObserverInit; disconnected: boolean }> = []
    vi.stubGlobal('IntersectionObserver', class {
      entry: (typeof opened)[number]
      constructor(callback: () => void, init?: IntersectionObserverInit) {
        this.entry = { callback, init, disconnected: false }
        opened.push(this.entry)
      }
      observe() {}
      disconnect() { this.entry.disconnected = true }
    })
    return opened
  }

  function mount(window: { older: { messageId: string } | null; newer: { messageId: string } | null }) {
    useChatStore.setState({
      activeProject: PROJECT,
      projectSessions: {
        [PROJECT]: {
          _activeSessionId: SID,
          _sessions: {
            [SID]: {
              sessionProvider: 'claude',
              preferredProvider: 'claude',
              messages: [],
              transcriptPaging: false,
              transcriptWindow: { ...window, total: 8 },
            },
          },
        },
      },
    } as never)
    const view = render(
      <div data-testid="scroller" style={{ overflowY: 'scroll' }}>
        <RemoteTranscriptEdges>
          <RemoteTranscriptChrome edge="top" />
          <div data-testid="transcript" />
          <RemoteTranscriptChrome edge="bottom" />
        </RemoteTranscriptEdges>
      </div>,
    )
    place(screen.getByTestId('scroller'), 0, 800)
    return view
  }

  it('loads the older page when the top edge is in reach, and shows only a loader', async () => {
    vi.useFakeTimers()
    observers()
    vi.mocked(pageRemoteTranscript).mockReturnValue(new Promise(() => {}) as never)
    mount({ older: { messageId: 'm0' }, newer: null })
    expect(pageRemoteTranscript).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).toHaveBeenCalledOnce()
    expect(pageRemoteTranscript).toHaveBeenCalledWith(PROJECT, SID, expect.anything(), {
      anchor: { messageId: 'm0' }, direction: 'before',
    })
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByRole('button')).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).toHaveBeenCalledOnce()
  })

  it('does not load while the top edge is more than a screen away', async () => {
    vi.useFakeTimers()
    observers()
    mount({ older: { messageId: 'm0' }, newer: null })
    place(screen.getByTestId('remote-transcript-chrome-top'), -2000, -1900)
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).not.toHaveBeenCalled()
  })

  it('retries a failed page on the next visit to that edge', async () => {
    vi.useFakeTimers()
    const opened = observers()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(pageRemoteTranscript).mockRejectedValue(new Error('offline'))
    mount({ older: { messageId: 'm0' }, newer: null })
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).toHaveBeenCalledOnce()
    place(screen.getByTestId('remote-transcript-chrome-top'), -2000, -1900)
    const live = () => opened.filter((entry) => !entry.disconnected)
    act(() => { for (const entry of live()) entry.callback() })
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    place(screen.getByTestId('remote-transcript-chrome-top'), 0, 8)
    act(() => { for (const entry of live()) entry.callback() })
    await act(async () => { await vi.advanceTimersByTimeAsync(80) })
    expect(pageRemoteTranscript).toHaveBeenCalledTimes(2)
  })
})

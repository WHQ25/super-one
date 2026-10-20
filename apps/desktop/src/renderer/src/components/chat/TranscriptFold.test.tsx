/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ContentBlock, ProcessFold } from '@superone/shared/agent-types'
import { groupContentPresenter } from '@superone/chat-view/presenters/groupContent'
import { TranscriptFoldPresenter } from '@superone/chat-view/presenters/TranscriptFold'
import { isPortablePinnedSegment, PORTABLE_GROUP_PORTS } from '@superone/chat-core/turn-process/portable'
import { summarizeClaudeProcess } from '@superone/chat-core/turn-process/process-stats'
import { isHiddenToolBlock } from '@superone/chat-core/turn-process/media-tools'
import { TurnBodyPresenter, type TurnBodyPresenterParts, type TurnDetailPresenterProps } from './presenters/TurnBody'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const fold: ProcessFold = {
  messageId: 'a', key: 'fold:thinking::0', revision: 'r1', fragments: 120, segments: 9, toolCalls: 60,
  files: ['/src/a.ts', '/src/b.ts'], moreFiles: 1, added: 30, removed: 4, contentKey: 'thinking::0',
}

/** IntersectionObservers the presenter opened, with their options, to drive by hand. */
function observers() {
  const opened: Array<{ callback: IntersectionObserverCallback; init?: IntersectionObserverInit; disconnected: boolean }> = []
  vi.stubGlobal('IntersectionObserver', class {
    entry: (typeof opened)[number]
    constructor(callback: IntersectionObserverCallback, init?: IntersectionObserverInit) {
      this.entry = { callback, init, disconnected: false }
      opened.push(this.entry)
    }
    observe() {}
    disconnect() { this.entry.disconnected = true }
  })
  const reach = () => act(() => {
    const live = opened.filter((entry) => !entry.disconnected).at(-1)!
    live.callback([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
  return { opened, reach }
}

describe('TranscriptFoldPresenter', () => {
  it('reads one page per reach, reading ahead only below the viewport', async () => {
    const { opened, reach } = observers()
    const load = vi.fn(async () => {})
    const { rerender } = render(<TranscriptFoldPresenter fold={fold} load={load} />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading...')
    expect(screen.queryByText(/tool call/)).toBeNull()
    expect(opened[0].init?.rootMargin).toBe('0px 0px 100% 0px')
    expect(load).not.toHaveBeenCalled()
    reach()
    expect(load).toHaveBeenCalledOnce()
    expect(load).toHaveBeenCalledWith(fold)
    // The same fold rendered again does not read again; its next page does.
    rerender(<TranscriptFoldPresenter fold={fold} load={load} />)
    expect(opened.filter((entry) => !entry.disconnected)).toHaveLength(0)
    // A later page in reach waits for the reader to scroll; a view following its tail does not count.
    rerender(<TranscriptFoldPresenter fold={{ ...fold, after: 'k', toolCalls: 40 }} load={load} />)
    reach()
    expect(load).toHaveBeenCalledOnce()
    act(() => { window.dispatchEvent(new Event('wheel')) })
    expect(load).toHaveBeenLastCalledWith({ ...fold, after: 'k', toolCalls: 40 })
  })

  it('stops on a failed read until the reader retries', async () => {
    const { reach } = observers()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    render(<TranscriptFoldPresenter fold={fold} load={load} />)
    reach()
    await act(async () => {})
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('retries a later page without waiting for another scroll', async () => {
    const { reach } = observers()
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    const later = { ...fold, after: 'k' }
    render(<TranscriptFoldPresenter fold={later} load={load} />)
    reach()
    expect(load).not.toHaveBeenCalled()
    act(() => { window.dispatchEvent(new Event('wheel')) })
    await act(async () => {})
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    await act(async () => {})
    expect(load).toHaveBeenCalledTimes(2)
    expect(load).toHaveBeenLastCalledWith(later)
  })
})

describe('a folded turn', () => {
  it('collapses and counts like the loaded turn, with the fold behind Detail', () => {
    const content: ContentBlock[] = [
      { type: 'notice', id: 'window:fold', level: 'info', kind: 'fold', text: '', fold },
      { type: 'text', text: 'Done.' },
    ]
    const detail = vi.fn((props: TurnDetailPresenterProps) => <>{props.runs.map((run) => <div key={run.key} data-collapsible={run.collapsible}>{run.content}</div>)}</>)
    const Fold = vi.fn(() => <span>folded</span>)
    const none = () => null
    const parts: TurnBodyPresenterParts = {
      Text: ({ text }) => <p>{text}</p>, Insight: none, Document: none, Tool: none, Reasoning: none, Subagent: none,
      Workflow: none, Plan: none, ToolGroup: none, AppToolGroup: none, TurnDetail: detail, Fold,
    }
    render(<TurnBodyPresenter grouped={groupContentPresenter(content, PORTABLE_GROUP_PORTS)} isStreaming={false} detailChatMode={false}
      projectPath={null} parts={parts} runtime={{ isBackgroundTool: () => false, isPinnedSegment: isPortablePinnedSegment,
        isHiddenTool: isHiddenToolBlock, summarizeProcess: summarizeClaudeProcess }} />)
    expect(detail).toHaveBeenCalled()
    expect(detail.mock.calls[0][0].stats).toEqual({ toolCalls: 60, filesChanged: 3, added: 30, removed: 4 })
    expect(screen.getByText('folded').closest('[data-collapsible]')?.getAttribute('data-collapsible')).toBe('true')
  })
})

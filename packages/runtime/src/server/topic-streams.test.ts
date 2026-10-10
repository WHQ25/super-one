import { describe, expect, it, vi } from 'vitest'
import type { TerminalEvent } from '@superone/shared/agent-types'
import type { DraftChangedEvent } from '@superone/shared/environment/draft-rpc'
import { DRAFT_SAVE_INTERVAL_MS, openDraftStream, openTerminalStream } from './topic-streams'

function source() {
  const listeners = new Set<(event: TerminalEvent) => void>()
  return {
    onEvent: (listener: (event: TerminalEvent) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit: (event: TerminalEvent) => { for (const listener of listeners) listener(event) },
    size: () => listeners.size,
  }
}

const output = (terminalId: string): TerminalEvent => ({ type: 'terminal_output', terminalId, data: 'x', fromSeq: 1, toSeq: 1, createdAt: 0 })
const exited = (terminalId: string): TerminalEvent => ({ type: 'terminal_exited', terminalId, exitCode: 0, signal: null })

describe('openTerminalStream', () => {
  it('follows its terminals, the list, a wildcard and topic changes, on its own environment only', () => {
    const src = source()
    const pushed: TerminalEvent[] = []
    const stream = openTerminalStream({
      source: src, environmentId: 'env', push: (e) => pushed.push(e),
      topics: [{ kind: 'terminal', environmentId: 'env', terminalId: 't1' }, { kind: 'terminal', environmentId: 'other', terminalId: 't2' }],
    })
    src.emit(output('t1'))
    src.emit(output('t2'))
    src.emit(exited('t2'))
    expect(pushed).toEqual([output('t1')])

    stream.setTopics([{ kind: 'terminalList', environmentId: 'env' }])
    src.emit(output('t1'))
    src.emit(exited('t2'))
    expect(pushed.slice(1)).toEqual([exited('t2')])

    stream.setTopics([{ kind: 'terminal', environmentId: 'env', terminalId: '*' }])
    src.emit(output('t9'))
    expect(pushed.at(-1)).toEqual(output('t9'))

    stream.close()
    expect(src.size()).toBe(0)
  })
})

describe('openDraftStream', () => {
  const changed = (draftId: string, reason: DraftChangedEvent['reason'], text = 'x'): DraftChangedEvent => ({
    type: 'draft_changed', draftId, reason,
    draft: { id: draftId, text, title: text, createdAt: '', updatedAt: '', attachments: [{ name: 'a.png', mimeType: 'image/png', data: 'AAAA' }] } as never,
  })

  it('leaves out attachment bytes and, off the local link, sends a draft\'s latest autosave once per interval', () => {
    vi.useFakeTimers()
    const listeners = new Set<(event: DraftChangedEvent) => void>()
    const pushed: DraftChangedEvent[] = []
    const stream = openDraftStream({
      source: { watch: (l) => { listeners.add(l); return () => listeners.delete(l) } },
      environmentId: 'env', topics: [{ kind: 'drafts', environmentId: 'env' }], throttleSaves: true,
      push: (e) => pushed.push(e),
    })
    const emit = (e: DraftChangedEvent) => { for (const l of listeners) l(e) }
    emit(changed('d1', 'saved', 'a'))
    emit(changed('d1', 'saved', 'ab'))
    expect(pushed).toEqual([])
    vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
    expect(pushed.map((e) => e.draft?.text)).toEqual(['ab'])
    expect(pushed[0].draft?.attachments?.[0]?.data).toBe('')

    emit(changed('d1', 'saved', 'abc'))
    emit(changed('d1', 'opened', 'abc'))
    vi.advanceTimersByTime(DRAFT_SAVE_INTERVAL_MS)
    expect(pushed.map((e) => e.reason)).toEqual(['saved', 'opened'])
    stream.close()
    expect(listeners.size).toBe(0)
    vi.useRealTimers()
  })
})

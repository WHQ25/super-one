import { describe, expect, it, vi } from 'vitest'
import { createCodexPromptPrediction } from './prompt-prediction'

function fixture() {
  let threadId: string | null = 'root'
  const onSuggestion = vi.fn()
  const prediction = createCodexPromptPrediction({ getThreadId: () => threadId, onSuggestion })
  const started = (id = 'turn-1', thread = 'root') => prediction.observe({ method: 'turn/started', params: { threadId: thread, turn: { id } } })
  const completed = (id = 'turn-1', status = 'completed', thread = 'root') => prediction.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id, status } } })
  const result = (value: unknown = { type: 'completed', text: 'Run tests' }, sourceTurnId = 'turn-1', thread = 'root') => prediction.observe({ method: 'thread/prediction/updated', params: { threadId: thread, sourceTurnId, result: value } })
  return { prediction, started, completed, result, onSuggestion, setThread: (id: string | null) => { threadId = id } }
}

describe('Codex session prompt predictions', () => {
  it('observes turn boundaries without consuming them and accepts a result after completion', () => {
    const f = fixture()
    expect(f.started()).toBe(false)
    expect(f.completed()).toBe(false)
    expect(f.result()).toBe(true)
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
    f.result()
    expect(f.onSuggestion).toHaveBeenCalledOnce()
  })

  it('consumes unknown, premature, stale and child-thread predictions without emitting them', () => {
    const f = fixture()
    expect(f.result()).toBe(true)
    f.started()
    f.result()
    f.started('child-turn', 'child')
    f.completed('child-turn', 'completed', 'child')
    f.result(undefined, 'child-turn', 'child')
    f.completed()
    f.result(undefined, 'older-turn')
    f.result(undefined, 'turn-1', 'other-thread')
    expect(f.onSuggestion).not.toHaveBeenCalled()
    f.result()
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('clears and invalidates the previous result as soon as a new turn starts', () => {
    const f = fixture()
    f.started(); f.completed(); f.result()
    f.started('turn-2')
    f.result()
    f.completed('turn-2')
    f.result({ type: 'completed', text: 'Open PR' }, 'turn-2')
    expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], [''], ['Open PR']])
  })

  it('invalidates in the gap between accepting new input and receiving turn/started', () => {
    const f = fixture()
    f.started(); f.completed(); f.result()
    f.prediction.invalidate()
    f.completed() // A duplicate terminal notification cannot revive the old source.
    f.result()
    expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], ['']])
  })

  it.each(['failed', 'interrupted'])('rejects a result for a %s turn', status => {
    const f = fixture()
    f.started(); f.completed('turn-1', status); f.result()
    expect(f.onSuggestion).not.toHaveBeenCalled()
  })

  it.each([{ type: 'failed' }, { type: 'completed', text: null }, { type: 'completed', text: ' \n ' }])('clears a shown suggestion for %j', result => {
    const f = fixture()
    f.started(); f.completed(); f.result(); f.result(result)
    expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], ['']])
  })

  it('ignores malformed payloads without changing the shown suggestion', () => {
    const f = fixture()
    f.started(); f.completed(); f.result()
    for (const result of [null, [], {}, { type: 'completed', text: 42 }, { type: 'unknown', text: 'bad' }]) f.result(result)
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('invalidates on compaction and never reuses a source after thread rebinding', () => {
    const f = fixture()
    f.started(); f.completed(); f.result()
    f.prediction.observe({ method: 'thread/compacted', params: { threadId: 'root' } })
    f.result()
    f.setThread('other')
    f.result(undefined, 'turn-1', 'other')
    f.setThread(null)
    f.result()
    expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], ['']])
  })
})

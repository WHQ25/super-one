import { describe, expect, it, vi } from 'vitest'
import { createCodexPromptPrediction } from './prompt-prediction'

function fixture() {
  const state = { threadId: 'root' as string | null }
  const onSuggestion = vi.fn()
  const prediction = createCodexPromptPrediction({ getThreadId: () => state.threadId, onSuggestion })
  return predictionFixture(state, onSuggestion, prediction)
}

function samplingFixture(sample: (threadId: string, turnId: string, signal: AbortSignal) => Promise<string | null | undefined>) {
  const state = { threadId: 'root' as string | null }
  let allowed = true
  const onSuggestion = vi.fn()
  const prediction = createCodexPromptPrediction({
    getThreadId: () => state.threadId,
    onSuggestion,
    sample,
    canSample: () => allowed,
  })
  return { ...predictionFixture(state, onSuggestion, prediction), setAllowed: (value: boolean) => { allowed = value } }
}

function predictionFixture(
  state: { threadId: string | null },
  onSuggestion: ReturnType<typeof vi.fn>,
  prediction: ReturnType<typeof createCodexPromptPrediction>,
) {
  const started = (id = 'turn-1', thread = 'root') => prediction.observe({ method: 'turn/started', params: { threadId: thread, turn: { id } } })
  const completed = (id = 'turn-1', status = 'completed', thread = 'root') => prediction.observe({ method: 'turn/completed', params: { threadId: thread, turn: { id, status } } })
  const result = (value: unknown = { type: 'completed', text: 'Run tests' }, sourceTurnId = 'turn-1', thread = 'root') => prediction.observe({ method: 'thread/prediction/updated', params: { threadId: thread, sourceTurnId, result: value } })
  return { prediction, started, completed, result, onSuggestion, setThread: (id: string | null) => { state.threadId = id } }
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

  it('samples a successful root turn and emits the parsed suggestion', async () => {
    const sample = vi.fn(async () => 'Fix the test')
    const f = samplingFixture(sample)
    f.started()
    f.completed()
    await vi.waitFor(() => expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Fix the test'))
    expect(sample).toHaveBeenCalledExactlyOnceWith('root', 'turn-1', expect.any(AbortSignal), 'turn_completed')
  })

  it('keeps a notification suggestion when the sample is unreadable', async () => {
    const sample = vi.fn(async () => undefined)
    const f = samplingFixture(sample)
    f.started()
    f.completed()
    f.result()
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce())
    await Promise.resolve()
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('clears a shown suggestion when the sample returns null', async () => {
    const sample = vi.fn(async () => null)
    const f = samplingFixture(sample)
    f.started()
    f.completed()
    f.result()
    await vi.waitFor(() => expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], ['']]))
  })

  it('aborts an in-flight sample and ignores the late result', async () => {
    let resolveSample!: (value: string) => void
    let signal!: AbortSignal
    const sample = vi.fn((_thread: string, _turn: string, next: AbortSignal) => {
      signal = next
      return new Promise<string>(resolve => { resolveSample = resolve })
    })
    const f = samplingFixture(sample)
    f.started()
    f.completed()
    f.result()
    await vi.waitFor(() => expect(signal).toBeInstanceOf(AbortSignal))
    expect(signal.aborted).toBe(false)
    f.prediction.invalidate()
    expect(signal.aborted).toBe(true)
    resolveSample('too late')
    await Promise.resolve()
    await Promise.resolve()
    expect(f.onSuggestion.mock.calls).toEqual([['Run tests'], ['']])
  })

  it('does not sample when the host disables it, and still accepts a notification', async () => {
    const sample = vi.fn(async () => 'nope')
    const f = samplingFixture(sample)
    f.setAllowed(false)
    f.started()
    f.completed()
    f.result()
    await Promise.resolve()
    expect(sample).not.toHaveBeenCalled()
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('does not sample a failed turn', async () => {
    const sample = vi.fn(async () => 'nope')
    const f = samplingFixture(sample)
    f.started()
    f.completed('turn-1', 'failed')
    await Promise.resolve()
    expect(sample).not.toHaveBeenCalled()
    expect(f.onSuggestion).not.toHaveBeenCalled()
  })

  it('does not clear a suggestion when the sample rejects', async () => {
    const sample = vi.fn(async () => { throw new Error('offline') })
    const f = samplingFixture(sample)
    f.started()
    f.completed()
    f.result()
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce())
    await Promise.resolve()
    await Promise.resolve()
    expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Run tests')
  })

  it('catch-up samples a finished turn this process did not watch', async () => {
    const sample = vi.fn(async () => 'Continue the tests')
    const f = samplingFixture(sample)
    f.prediction.catchUp('root', 'turn-9')
    await vi.waitFor(() => expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Continue the tests'))
    expect(sample).toHaveBeenCalledExactlyOnceWith('root', 'turn-9', expect.any(AbortSignal), 'catch_up')
    f.prediction.catchUp('root', 'turn-9')
    await Promise.resolve()
    expect(sample).toHaveBeenCalledOnce()
  })

  it('does not catch up a turn that is still running, another thread, or a disabled host', async () => {
    const sample = vi.fn(async () => 'nope')
    const f = samplingFixture(sample)
    f.started('turn-2')
    f.prediction.catchUp('root', 'turn-9')
    f.prediction.catchUp('other', 'turn-9')
    f.setAllowed(false)
    f.prediction.catchUp('root', 'turn-8')
    await Promise.resolve()
    expect(sample).not.toHaveBeenCalled()
  })

  it('replaces an older catch-up when a newer finished turn appears', async () => {
    let resolveFirst!: (value: string) => void
    const sample = vi.fn((_thread: string, turn: string) => turn === 'turn-1'
      ? new Promise<string>(resolve => { resolveFirst = resolve })
      : Promise.resolve('Newer'))
    const f = samplingFixture(sample)
    f.prediction.catchUp('root', 'turn-1')
    await vi.waitFor(() => expect(sample).toHaveBeenCalledOnce())
    f.prediction.catchUp('root', 'turn-2')
    await vi.waitFor(() => expect(f.onSuggestion).toHaveBeenCalledExactlyOnceWith('Newer'))
    resolveFirst('stale')
    await Promise.resolve()
    await Promise.resolve()
    expect(f.onSuggestion).toHaveBeenCalledOnce()
    expect(sample).toHaveBeenLastCalledWith('root', 'turn-2', expect.any(AbortSignal), 'catch_up')
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

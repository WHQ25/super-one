import { describe, expect, it, vi } from 'vitest'
import {
  catchUpCodexPromptSuggestion,
  codexPromptSampleParams,
  readCodexCollaborationModeName,
  readCodexPromptSampleSuggestion,
  readLatestCompletedCodexTurnId,
  sampleCodexPromptSuggestion,
} from './prompt-sample'

describe('Codex prompt sample parsing', () => {
  it('reads a suggestion and treats an explicit empty result as no suggestion', () => {
    expect(readCodexPromptSampleSuggestion({ text: ' {"suggestion":" Run tests "} ' })).toBe('Run tests')
    expect(readCodexPromptSampleSuggestion({ text: '{"suggestion":null}' })).toBeNull()
    expect(readCodexPromptSampleSuggestion({ text: null })).toBeNull()
    expect(readCodexPromptSampleSuggestion({ text: '' })).toBeNull()
    expect(readCodexPromptSampleSuggestion({ text: '{"suggestion":"  "}' })).toBeNull()
  })

  it('leaves the composer alone when the sample text is unreadable', () => {
    expect(readCodexPromptSampleSuggestion(undefined)).toBeUndefined()
    expect(readCodexPromptSampleSuggestion({})).toBeUndefined()
    expect(readCodexPromptSampleSuggestion({ text: 'not json' })).toBeUndefined()
    expect(readCodexPromptSampleSuggestion({ text: '{"other":1}' })).toBeUndefined()
    expect(readCodexPromptSampleSuggestion({ text: '{"suggestion":1}' })).toBeUndefined()
    expect(readCodexPromptSampleSuggestion({ text: '[]' })).toBeUndefined()
  })

  it('reads a collaboration mode from a string or a mode object', () => {
    expect(readCodexCollaborationModeName(' plan ')).toBe('plan')
    expect(readCodexCollaborationModeName({ mode: 'default' })).toBe('default')
    expect(readCodexCollaborationModeName(undefined)).toBeNull()
    expect(readCodexCollaborationModeName({ mode: ' ' })).toBeNull()
  })

  it('requests one sample without mid-turn sampling', () => {
    const params = codexPromptSampleParams('thread-1', 'turn-1')
    expect(params).toMatchObject({
      threadId: 'thread-1',
      expectedTurnId: 'turn-1',
      effort: 'low',
      threadSource: 'composer_predictions',
      turnTrigger: 'composer_predictions',
      disableMcp: true,
      responsesapiClientMetadata: {
        prediction_source_thread_id: 'thread-1',
        prediction_source_turn_id: 'turn-1',
        prediction_trigger: 'turn_completed',
      },
    })
    expect(params).not.toHaveProperty('allowInProgressTurn')
    expect(params.prompt).toContain('{"suggestion":string|null}')
    expect(codexPromptSampleParams('thread-1', 'turn-1', 'catch_up').responsesapiClientMetadata).toMatchObject({
      prediction_trigger: 'catch_up',
    })
  })

  it('reads only the newest completed turn', () => {
    expect(readLatestCompletedCodexTurnId({ data: [{ id: 'turn-9', status: 'completed' }, { id: 'older', status: 'completed' }] })).toBe('turn-9')
    expect(readLatestCompletedCodexTurnId({ data: [{ id: 'turn-9', status: 'failed' }] })).toBeNull()
    expect(readLatestCompletedCodexTurnId({ data: [{ id: 'turn-9', status: 'inProgress' }] })).toBeNull()
    expect(readLatestCompletedCodexTurnId({ data: [] })).toBeNull()
  })

  it('asks the predictor to catch up the newest completed turn', async () => {
    const request = vi.fn(async () => ({ data: [{ id: 'turn-9', status: 'completed' }] }))
    const catchUp = vi.fn()
    await catchUpCodexPromptSuggestion({ request }, { catchUp }, 'thread-1')
    expect(request).toHaveBeenCalledWith('thread/turns/list', {
      threadId: 'thread-1',
      sortDirection: 'desc',
      itemsView: 'notLoaded',
      limit: 1,
    })
    expect(catchUp).toHaveBeenCalledExactlyOnceWith('thread-1', 'turn-9')
  })

  it('does not call the server when the sample is already cancelled', async () => {
    const request = vi.fn()
    const controller = new AbortController()
    controller.abort()
    await expect(sampleCodexPromptSuggestion({ request }, 'thread-1', 'turn-1', controller.signal)).resolves.toBeUndefined()
    expect(request).not.toHaveBeenCalled()
  })

  it('treats a failed sample as unreadable', async () => {
    const request = vi.fn(async () => { throw new Error('offline') })
    const controller = new AbortController()
    await expect(sampleCodexPromptSuggestion({ request }, 'thread-1', 'turn-1', controller.signal)).resolves.toBeUndefined()
    expect(request).toHaveBeenCalledWith('thread/sample', expect.any(Object), expect.objectContaining({
      signal: expect.any(AbortSignal),
      timeoutMs: 30_000,
    }))
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ComposerSettledEvent } from '@superone/shared/agent-types'
import { admitInputRequestSpec, inputRequestMeta, type InputRequestOutput } from '@superone/shared/input-request'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const {
  awaitComposerForm,
  cancelComposerForms,
  clearComposerDeliveriesForTests,
  composerFormOutcome,
  openComposerForm,
  releaseComposerClient,
} = await import('./composer-delivery')
const { claimInputRequestForSend, clearInputRequestsForTests, isInputRequestId, openInputRequest, respondToInputRequest } = await import('./input-requests')

const spec = { title: 'Pick', requestedSchema: { type: 'object', properties: { color: { type: 'string' } }, required: ['color'] } }
const win = { kind: 'window' as const, id: 1 }
const otherWin = { kind: 'window' as const, id: 2 }
const phone = { kind: 'device' as const, id: 'd1' }

function session(id = 's1') {
  const events: AgentEvent[] = []
  return { id, events, emitHostEvent: (event: AgentEvent) => { events.push(event) } }
}

function show(output: InputRequestOutput) {
  const admitted = admitInputRequestSpec(spec, { userResources: true })
  if (!admitted.ok) throw new Error(admitted.error)
  const target = session()
  const { requestId, outcome } = openInputRequest(target, { meta: inputRequestMeta(admitted.spec, { kind: 'widget', messageId: 'm1' }, output), form: admitted.form })
  return { requestId, sessionId: target.id, output, outcome }
}

function opened(client: typeof win | typeof phone, frame: { viewId: string; localId: string; output?: InputRequestOutput }, push?: (event: ComposerSettledEvent) => void) {
  const result = openComposerForm(client, frame, show, push)
  if (!result.ok) throw new Error(result.error.message)
  return result.requestId
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

afterEach(() => {
  clearComposerDeliveriesForTests()
  clearInputRequestsForTests()
})

describe('composer delivery to a desktop window', () => {
  it('acknowledges at once and resolves the await with caller values, defaulting to caller output', async () => {
    const requestId = opened(win, { viewId: 'v1', localId: 'l1' })
    const answer = awaitComposerForm(win, requestId)
    expect(respondToInputRequest('s1', requestId, { allow: true, formAnswers: { color: 'red' } })).toBe(true)
    await expect(answer).resolves.toEqual({ status: 'submitted', values: { color: 'red' } })
  })

  it('hands an answer that settled before the await over once', async () => {
    const requestId = opened(win, { viewId: 'v1', localId: 'l1' })
    respondToInputRequest('s1', requestId, { allow: false })
    await settle()
    await expect(awaitComposerForm(win, requestId)).resolves.toEqual({ status: 'cancelled', reason: 'user' })
    await expect(awaitComposerForm(win, requestId)).rejects.toThrow(/not open in this window/)
  })

  it('rejects at once for unknown forms and for another window', async () => {
    const requestId = opened(win, { viewId: 'v1', localId: 'l1' })
    await expect(awaitComposerForm(otherWin, requestId)).rejects.toThrow(/not open in this window/)
    await expect(awaitComposerForm(win, 'inputrequest-nope')).rejects.toThrow(/not open in this window/)
  })

  it('withholds agent-output values from the opener', async () => {
    const requestId = opened(win, { viewId: 'v1', localId: 'l1', output: 'agent' })
    const answer = awaitComposerForm(win, requestId)
    claimInputRequestForSend('s1', { content: '', clientMessageId: 'c1', inputRequest: { requestId, values: { color: 'red' } } })
    await expect(answer).resolves.toEqual({ status: 'submitted' })
  })

  it('validates frame ids and output, and refuses a reused local id while its form is open', () => {
    expect(openComposerForm(win, { viewId: '', localId: 'l1' }, show)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(openComposerForm(win, { viewId: 'v1', localId: 'l1', output: 'both' }, show)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    opened(win, { viewId: 'v1', localId: 'l1' })
    expect(openComposerForm(win, { viewId: 'v1', localId: 'l1' }, show)).toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(openComposerForm(win, { viewId: 'v2', localId: 'l1' }, show).ok).toBe(true)
  })

  it('cancels one form by local id, only for the frame that opened it', async () => {
    const requestId = opened(win, { viewId: 'v1', localId: 'l1' })
    const answer = awaitComposerForm(win, requestId)
    cancelComposerForms(otherWin, 'v1', 'l1')
    expect(isInputRequestId(requestId)).toBe(true)
    cancelComposerForms(win, 'v1', 'l1')
    await expect(answer).resolves.toEqual({ status: 'cancelled', reason: 'aborted' })
  })

  it('releasing a view closes its caller forms but leaves agent forms for the agent', async () => {
    const caller = opened(win, { viewId: 'v1', localId: 'a' })
    const agent = opened(win, { viewId: 'v1', localId: 'b', output: 'agent' })
    const other = opened(win, { viewId: 'v2', localId: 'c' })
    const waits = [awaitComposerForm(win, caller), awaitComposerForm(win, agent)]
    cancelComposerForms(win, 'v1')
    await expect(Promise.all(waits)).resolves.toEqual([
      { status: 'cancelled', reason: 'owner_disposed' },
      { status: 'cancelled', reason: 'owner_disposed' },
    ])
    expect(isInputRequestId(caller)).toBe(false)
    expect(isInputRequestId(agent)).toBe(true)
    expect(isInputRequestId(other)).toBe(true)
    releaseComposerClient(win)
    expect(isInputRequestId(other)).toBe(false)
  })
})

describe('composer delivery to a phone', () => {
  it('pushes the answer to the opening device only and lets it collect a missed push once', async () => {
    const pushed: Array<[string, ComposerSettledEvent]> = []
    const requestId = opened(phone, { viewId: 'v1', localId: 'l1' }, event => { pushed.push([phone.id, event]) })
    expect(composerFormOutcome(phone, requestId)).toEqual({ state: 'pending' })
    respondToInputRequest('s1', requestId, { allow: true, formAnswers: { color: 'red' } })
    await settle()
    expect(pushed).toEqual([['d1', { type: 'composer_settled', sessionId: 's1', requestId, viewId: 'v1', localId: 'l1', outcome: { status: 'submitted', values: { color: 'red' } } }]])
    expect(composerFormOutcome({ kind: 'device', id: 'd2' }, requestId)).toEqual({ state: 'unknown' })
    expect(composerFormOutcome(phone, requestId)).toEqual({ state: 'settled', outcome: { status: 'submitted', values: { color: 'red' } } })
    expect(composerFormOutcome(phone, requestId)).toEqual({ state: 'unknown' })
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@superone/shared/agent-types'

vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const { composerRequestHandler } = await import('./input-request-tools')
const { clearInputRequestsForTests, respondToInputRequest } = await import('../session/input-requests')
const { _resetMainThreadSessionGuardForTests } = await import('./main-thread-session-guard')

const form = {
  title: 'Deploy target',
  requestedSchema: { type: 'object', properties: { env: { type: 'string', enum: ['staging', 'prod'] } }, required: ['env'] },
}

function deps(signal?: AbortSignal) {
  const events: AgentEvent[] = []
  const session = { setTitle: vi.fn(), emitHostEvent: (event: AgentEvent) => { events.push(event) } }
  return {
    events,
    deps: {
      sessionId: 's1',
      sessionHost: { getSession: (id: string) => (id === 's1' ? session : null) },
      applyAppSettings: vi.fn(),
      notifyDevAppReady: vi.fn(),
      ...(signal ? { signal } : {}),
    } as never,
  }
}

function text(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>
}

afterEach(() => {
  clearInputRequestsForTests()
  _resetMainThreadSessionGuardForTests()
})

describe('composer_request', () => {
  it('waits for the submitted values and returns them to the turn', async () => {
    const { events, deps: toolDeps } = deps()
    const pending = composerRequestHandler(form, toolDeps)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    const event = events[0]!
    if (event.type !== 'permission_request') throw new Error('expected a prompt')
    expect(event.request.inputRequest).toMatchObject({ origin: { kind: 'agent' }, output: 'caller' })
    expect(respondToInputRequest('s1', event.request.requestId, { allow: true, formAnswers: { env: 'prod' } })).toBe(true)
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(text(result)).toEqual({ status: 'submitted', values: { env: 'prod' } })
  })

  it('returns a neutral cancellation when the turn is interrupted, dismissing the form', async () => {
    const controller = new AbortController()
    const { events, deps: toolDeps } = deps(controller.signal)
    const pending = composerRequestHandler(form, toolDeps)
    await vi.waitFor(() => expect(events).toHaveLength(1))
    controller.abort()
    const result = await pending
    expect(result.isError).toBeUndefined()
    expect(text(result)).toMatchObject({ status: 'cancelled', reason: 'aborted', hint: expect.stringMatching(/Do not reopen/) })
    expect(events.at(-1)).toMatchObject({ type: 'interaction_resolved' })
  })

  it('rejects an invalid form with an actionable error and shows nothing', async () => {
    const { events, deps: toolDeps } = deps()
    const result = await composerRequestHandler({ title: 'x', requestedSchema: { type: 'object', properties: {} } }, toolDeps)
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringMatching(/no fields.*call composer_request again/) }] })
    expect(events).toEqual([])
  })
})

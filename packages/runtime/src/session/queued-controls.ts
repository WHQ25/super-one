import type { TurnOpts } from './accepted-turn'
import type { NodeSessionRecord, TurnRunner } from './types'

export async function operateNodeQueue(method: string, input: Record<string, unknown>, deps: {
  session: NodeSessionRecord
  queue: TurnOpts[]
  admitting: Set<string>
  runner: TurnRunner
  assertControl(): void
  consumed(turn: TurnOpts): void
  dequeued(turn: TurnOpts): void
  abandoned(turn: TurnOpts): void
}) {
  const id = typeof input.clientMessageId === 'string' ? input.clientMessageId : ''
  if (!id) throw Object.assign(new Error('clientMessageId required'), { code: 'invalid_argument' })
  const index = deps.queue.findIndex(turn => turn.clientMessageId === id)
  if (index < 0) {
    if (method === 'session.dequeue') return { removed: false }
    throw Object.assign(new Error('Queued message is no longer pending'), { code: 'failed_precondition' })
  }
  deps.assertControl()
  const turn = deps.queue[index]!
  if (!turn.parkInComposer) throw Object.assign(new Error('Only composer queue cards support this operation'), { code: 'unsupported' })
  if (method === 'session.dequeue') {
    deps.queue.splice(index, 1); deps.dequeued(turn)
    return { removed: true }
  }
  if (deps.session.harnessId !== 'opencode' || !deps.runner.steer)
    throw Object.assign(new Error('This session does not support queued steering'), { code: 'unsupported' })
  if (input.priority !== undefined && input.priority !== 'now')
    throw Object.assign(new Error('OpenCode only supports immediate steering'), { code: 'unsupported' })
  if (deps.admitting.has(deps.session.sessionId)) throw new Error('Another queued input is being submitted')
  deps.admitting.add(deps.session.sessionId)
  deps.queue.splice(index, 1)
  let consumed = false
  let submitted = false
  try {
    await deps.runner.steer(deps.session, { text: turn.text, clientMessageId: id, model: turn.model,
      effort: turn.effort, agent: turn.agent, images: turn.images }, {
      assertControl: deps.assertControl,
      onInputAccepted: () => { submitted = true },
      onConsumed: () => { if (!consumed) { consumed = true; deps.consumed(turn) } },
    })
    return { ok: true }
  } catch (error) {
    if (!consumed) {
      if (!deps.session.closed && !['interrupted', 'error', 'ended'].includes(deps.session.status))
        deps.queue.splice(Math.min(index, deps.queue.length), 0, turn)
      else if (submitted) deps.consumed(turn)
      else deps.abandoned(turn)
    }
    throw error
  } finally { deps.admitting.delete(deps.session.sessionId) }
}

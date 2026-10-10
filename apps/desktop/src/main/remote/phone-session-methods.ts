import type { CodexGoalStatus } from '@superone/shared/agent-types'
import type { RpcContext } from '@superone/runtime/server'
import { claimAutoRecapDispatch, finishAutoRecapDispatch } from '../acp/acp-recap-focus'
import { answerRemoteAsyncQuestion } from '../agent/remote-async-question'
import { runFencedSessionControl } from '../session/control-context'
import { enqueueSessionQueueOp, queuedSteerCommand } from '../session/session-queue'
import type { Session } from '../session/types'

export interface PhoneSessionMethodHost {
  getSession(sessionId: string): Session | null | undefined
}

type Handler = (p: Record<string, unknown>, ctx: RpcContext) => unknown | Promise<unknown>
const invalid = (message: string) => Object.assign(new Error(message), { code: 'invalid_argument' })
function text(p: Record<string, unknown>, key: string): string {
  if (typeof p[key] !== 'string' || !p[key]) throw invalid(`${key} is required`)
  return p[key] as string
}
const GOAL_STATUSES: ReadonlySet<string> = new Set(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'])

/** Session operations already exposed by the desktop, beyond the shared node family. */
export function createPhoneSessionMethods(host: PhoneSessionMethodHost): Record<string, Handler> {
  const fenced = (handler: (session: Session, p: Record<string, unknown>, ctx: RpcContext) => unknown | Promise<unknown>): Handler => (p, ctx) => {
    const sessionId = text(p, 'sessionId')
    if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    const proof = { leaseId: text(p, 'leaseId'), generation: text(p, 'generation') }
    ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId }, ...proof, holderClientId: ctx.client.clientSessionId })
    const session = host.getSession(sessionId)
    if (!session) throw Object.assign(new Error('Session is not running'), { code: 'failed_precondition' })
    return runFencedSessionControl(sessionId, ctx.client.clientSessionId, proof, () => {
      session.lease.assertMutation()
      return handler(session, p, ctx)
    })
  }
  return {
    'session.recap': fenced(async (session, p) => {
      const auto = p.auto === true
      if (!session.requestSessionRecap || (auto && !claimAutoRecapDispatch(session.id))) return { ok: false }
      try {
        const ok = await session.requestSessionRecap(auto)
        if (auto) finishAutoRecapDispatch(session.id, ok)
        return { ok }
      } catch (error) {
        if (auto) finishAutoRecapDispatch(session.id, false)
        throw error
      }
    }),
    'session.setGoal': fenced(async (session, p) => {
      if (p.status !== undefined && (typeof p.status !== 'string' || !GOAL_STATUSES.has(p.status))) throw invalid('invalid goal status')
      if (p.objective === null) {
        if (!session.clearCodexGoal) throw Object.assign(new Error('Goal is not supported'), { code: 'unsupported' })
        await session.clearCodexGoal(null)
      } else {
        if (!session.setCodexGoal) throw Object.assign(new Error('Goal is not supported'), { code: 'unsupported' })
        await session.setCodexGoal(null, text(p, 'objective'), p.status as CodexGoalStatus | undefined)
      }
      return { ok: true }
    }),
    'session.dequeue': fenced(async (session, p) => {
      const clientMessageId = text(p, 'clientMessageId')
      return enqueueSessionQueueOp(session.id, async () => {
        session.lease.assertMutation()
        return { removed: await session.dequeueMessage(clientMessageId) }
      })
    }),
    'session.steer': fenced(async (session, p) => {
      if (p.priority !== undefined && p.priority !== 'now' && p.priority !== 'next') throw invalid('priority must be now|next')
      const command = queuedSteerCommand(session.snapshot.harnessId, text(p, 'clientMessageId'), p.priority ?? 'now')
      if (!command) throw Object.assign(new Error('Queued steer is not supported on this harness'), { code: 'unsupported' })
      await enqueueSessionQueueOp(session.id, async () => {
        session.lease.assertMutation()
        await session.dispatchBackendCommand(command)
      })
      return { ok: true }
    }),
    'session.answerAsyncQuestion': fenced(async (session, p) => {
      if (!Array.isArray(p.answers) || p.answers.some(value => typeof value !== 'string')) throw invalid('answers must be a string array')
      const reply = await answerRemoteAsyncQuestion(session, { messageId: text(p, 'messageId'), itemId: text(p, 'itemId'), answers: p.answers as string[] })
      return { reply }
    }),
    'composer.openInputRequest': fenced(async (session, p) => {
      const { composerOpenResult, openWidgetInputRequest } = await import('../session/input-requests')
      session.lease.assertMutation()
      return composerOpenResult(() => openWidgetInputRequest(session, { projectPath: session.projectPath, sessionId: session.id, messageId: text(p, 'messageId'), spec: p.spec, output: 'agent' }))
    }),
    'composer.open': fenced(async (session, p, ctx) => {
      const [{ openComposerForm }, { openWidgetInputRequest }] = await Promise.all([import('../session/composer-delivery'), import('../session/input-requests')])
      session.lease.assertMutation()
      return openComposerForm(composerClient(ctx), { viewId: p.viewId, localId: p.localId, output: p.output }, output =>
        openWidgetInputRequest(session, { projectPath: session.projectPath, sessionId: session.id, messageId: text(p, 'messageId'), spec: p.spec, output }),
      ctx.streams ? (event) => ctx.streams!.push({ type: 'client', event }) : undefined)
    }),
    'composer.cancel': async (p, ctx) => {
      const { cancelComposerForms } = await import('../session/composer-delivery')
      const viewId = text(p, 'viewId')
      if (p.localId !== undefined && typeof p.localId !== 'string') throw invalid('localId must be a string')
      cancelComposerForms(composerClient(ctx), viewId, p.localId as string | undefined)
      return { ok: true }
    },
    'composer.outcome': async (p, ctx) => {
      const { composerFormOutcome } = await import('../session/composer-delivery')
      return composerFormOutcome(composerClient(ctx), text(p, 'inputRequestId'))
    },
  }
}

/** A view belongs to the authenticated paired phone or Electron window, never payload ids. */
function composerClient(ctx: RpcContext): import('../session/composer-delivery').ComposerClient {
  const clientId = ctx.client.clientSessionId
  if (clientId.startsWith('phone:')) return { kind: 'device', id: clientId.slice(6) }
  if (/^ipc:\d+$/.test(clientId)) return { kind: 'window', id: Number(clientId.slice(4)) }
  throw Object.assign(new Error('Composer views require a paired frontend'), { code: 'unsupported' })
}

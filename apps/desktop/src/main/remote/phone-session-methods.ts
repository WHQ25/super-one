import type { CodexGoalStatus } from '@superone/shared/agent-types'
import type { RpcContext } from '@superone/runtime/server'
import { claimAutoRecapDispatch, finishAutoRecapDispatch } from '../acp/acp-recap-focus'
import { answerRemoteAsyncQuestion } from '../agent/remote-async-question'
import { runFencedSessionControl } from '../session/control-context'
import { enqueueSessionQueueOp, queuedSteerCommand } from '../session/session-queue'
import type { Session } from '../session/types'
import { phoneMethodText as text, invalidPhoneArgument as invalid } from './phone-method-input'
import type { SuggestedTaskLaunchChoice, SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'
import { parseSuggestedTaskChoice } from '@superone/shared/suggested-task'

export interface PhoneSessionMethodHost {
  getSession(sessionId: string): Session | null | undefined
  suggestedTaskLaunchOptions?(sessionId: string, taskId: string): Promise<SuggestedTaskLaunchOptions>
  launchSuggestedTask?(sessionId: string, taskId: string, choice: SuggestedTaskLaunchChoice | undefined, assertControl: () => void): Promise<{ sessionId: string }>
  openMiniAppForm?(request: import('../miniapp/miniapp-input-requests').MiniAppInputRequest): import('../session/input-requests').OpenedInputRequest
}

type Handler = (p: Record<string, unknown>, ctx: RpcContext) => unknown | Promise<unknown>
const GOAL_STATUSES: ReadonlySet<string> = new Set(['active', 'paused', 'blocked', 'usageLimited', 'budgetLimited', 'complete'])

/** Session operations already exposed by the desktop, beyond the shared node family. */
export function createPhoneSessionMethods(host: PhoneSessionMethodHost): Record<string, Handler> {
  const fenced = (handler: (session: Session, p: Record<string, unknown>, ctx: RpcContext, assertControl: () => void) => unknown | Promise<unknown>): Handler => (p, ctx) => {
    const sessionId = text(p, 'sessionId')
    if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
    const proof = { leaseId: text(p, 'leaseId'), generation: text(p, 'generation') }
    const assertControl = () => ctx.leases.assertValid({ resource: { environmentId: ctx.identity.environmentId, sessionId }, ...proof, holderClientId: ctx.client.clientSessionId })
    assertControl()
    const session = host.getSession(sessionId)
    if (!session) throw Object.assign(new Error('Session is not running'), { code: 'failed_precondition' })
    return runFencedSessionControl(sessionId, ctx.client.clientSessionId, proof, () => {
      session.lease.assertMutation()
      return handler(session, p, ctx, assertControl)
    })
  }
  return {
    ...(host.suggestedTaskLaunchOptions ? {
      'session.suggestedTaskLaunchOptions': (p: Record<string, unknown>, ctx: RpcContext) => {
        const sessionId = text(p, 'sessionId')
        if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
        return host.suggestedTaskLaunchOptions!(sessionId, text(p, 'taskId'))
      },
    } : {}),
    ...(host.launchSuggestedTask ? {
      'session.launchSuggestedTask': fenced((session, p, _ctx, assertControl) => host.launchSuggestedTask!(session.id, text(p, 'taskId'), parseSuggestedTaskChoice(p.choice), assertControl)),
    } : {}),
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
    'session.getGoal': async (p, ctx) => {
      const sessionId = text(p, 'sessionId')
      if (!ctx.sessions?.get(sessionId)) throw Object.assign(new Error('session not found'), { code: 'not_found' })
      const session = host.getSession(sessionId)
      // The app server reports a goal only when asked, and only for a running thread.
      if (!session?.getCodexGoal || session.snapshot.harnessId !== 'codex') return { goal: null }
      return { goal: await session.getCodexGoal(null) }
    },
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
      const source = p.source as import('@superone/shared/agent-types').ComposerSource | undefined
      return openComposerForm(composerClient(ctx), { viewId: p.viewId, localId: p.localId, output: p.output }, output => {
        if (source?.kind === 'miniapp') {
          if (!ctx.client.clientSessionId.startsWith('ipc:') || !host.openMiniAppForm) throw Object.assign(new Error('Mini-app forms require a desktop window'), { code: 'unsupported' })
          return host.openMiniAppForm({ projectDir: source.projectDir, appId: source.appId, sessionId: session.id, spec: p.spec, output })
        }
        return openWidgetInputRequest(session, { projectPath: session.projectPath, sessionId: session.id, messageId: text(p, 'messageId'), spec: p.spec, output })
      },
      ctx.streams ? (event) => ctx.streams!.push({ type: 'client', event }) : undefined)
    }),
    'composer.cancel': async (p, ctx) => {
      const { cancelComposerForms } = await import('../session/composer-delivery')
      const viewId = text(p, 'viewId')
      if (p.localId !== undefined && typeof p.localId !== 'string') throw invalid('localId must be a string')
      cancelComposerForms(composerClient(ctx), viewId, p.localId as string | undefined)
      return { ok: true }
    },
    'composer.await': async (p, ctx) => {
      const { awaitComposerForm } = await import('../session/composer-delivery')
      return awaitComposerForm(composerClient(ctx), text(p, 'inputRequestId'))
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

import type { AgentEvent, ChatMessage, ModelFallbackMeta } from '@superone/shared/agent-types'

type ModelFallbackEvent = Extract<AgentEvent, { type: 'model_fallback' }>

/**
 * Identity of one swap, so a retry loop that re-announces the same hop does not
 * mint a second row. Chain advance emits one event per hop and each hop lands on
 * a different model, so distinct hops still each get their own row.
 */
export function modelFallbackSignature(event: ModelFallbackEvent): string {
  return [
    event.trigger,
    event.fromModel ?? '',
    event.toModel ?? '',
    // A decline and a swap are different news even for the same trigger + model.
    event.outcome ?? '',
    event.scope ?? '',
  ].join('|')
}

/**
 * Build the "switched model" transcript row for an automatic model swap.
 *
 * This is a real transcript message rather than transient session state on
 * purpose: which model answered outlives the turn it happened in, so the notice
 * has to survive `status: idle`, a reload and a session switch, and has to keep
 * its chronological position among the messages it applies to.
 *
 * Like {@link buildOrphanTaskNotificationMessage} it is a `providerId: 'system'`
 * assistant message so it stays out of `extractClaudeTitle`, and its text block
 * is plain prose because DB rows, transcript exports and the mobile snapshot all
 * read it directly — only the desktop chat knows how to render
 * `metadata.modelFallback`.
 */
export function buildModelFallbackMessage(event: ModelFallbackEvent): ChatMessage {
  const declined = event.outcome === 'declined'
  const meta: ModelFallbackMeta = {
    trigger: event.trigger,
    ...(event.fromModel ? { fromModel: event.fromModel } : {}),
    ...(event.toModel ? { toModel: event.toModel } : {}),
    ...(event.outcome ? { outcome: event.outcome } : {}),
    ...(event.scope ? { scope: event.scope } : {}),
    ...(event.refusalCategory === undefined ? {} : { refusalCategory: event.refusalCategory }),
  }

  const head = declined
    ? `${event.fromModel ?? 'The model'} declined and no fallback was available`
    : [
        event.toModel ? `Switched to ${event.toModel}` : 'Switched model',
        event.fromModel ? ` from ${event.fromModel}` : '',
        // A local swap covered one subagent / side-question only; saying the
        // session switched would be wrong.
        event.scope === 'local' ? ' for this response only' : '',
      ].join('')
  const text = `${head} (${event.trigger})`

  return {
    id: `model_fallback_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'system',
    metadata: { modelFallback: meta },
  }
}

import { expect, it } from 'vitest'
import { mapNodeSessionEvents } from '@superone/shared/node-session-event-map'
import { nodePendingInteractionFields } from '@superone/shared/node-session-messages'
import type { AgentEvent } from '@superone/shared/agent-types'
import type { EnvironmentEventEnvelope } from '@superone/shared/environment/events'
import { createDefaultChatCoreSession } from './defaults'
import { applyEventToSession } from './reducer'

it.each(['live', 'snapshot'] as const)('keeps a queued child checkpoint visible across root cancellation (%s)', source => {
  const session = createDefaultChatCoreSession()
  const apply = (event: AgentEvent) => Object.assign(session, applyEventToSession(session, event))
  const pending = { interactionId: 'child', kind: 'permission' as const, toolName: 'Bash', input: { command: 'build' }, createdAt: 1, requiresHumanApproval: true }
  if (source === 'live') {
    const events = mapNodeSessionEvents([{
      eventId: 'e1', sequence: '1', timestamp: 1, aggregateType: 'session', aggregateId: 's',
      eventType: 'session.permission_requested', eventVersion: 1, environmentId: 'node', payload: pending,
    } as EnvironmentEventEnvelope], { sessionId: 's', providerId: 'codex' })
    events.forEach(apply)
  } else Object.assign(session, nodePendingInteractionFields(pending))
  apply({ type: 'message_interrupted', messageId: 'root' })
  expect(session.pendingPermissions.map(p => p.requestId)).toEqual(['child'])
  apply({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'root' })
  expect(session.pendingPermissions.map(p => p.requestId)).toEqual(['child'])
  apply({ type: 'interaction_resolved', interactionType: 'permission', requestId: 'child' })
  expect(session.pendingPermissions).toEqual([])
})

it.each(['question', 'plan'] as const)('retains the node-owned %s released by the interaction queue', kind => {
  const session = createDefaultChatCoreSession()
  Object.assign(session, nodePendingInteractionFields({ interactionId: 'next', kind, input: { plan: 'Review changes' } }))
  Object.assign(session, applyEventToSession(session, { type: 'message_interrupted', messageId: 'root' }))
  expect((kind === 'question' ? session.pendingQuestion : session.pendingPlanApproval)?.requestId).toBe('next')
  Object.assign(session, applyEventToSession(session, { type: 'interaction_resolved', interactionType: kind === 'question' ? 'question' : 'plan_approval', requestId: 'next' }))
  expect(kind === 'question' ? session.pendingQuestion : session.pendingPlanApproval).toBeNull()
})

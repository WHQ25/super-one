import { afterEach, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
const { stored } = vi.hoisted(() => ({ stored: { timeline: '' } }))
vi.mock('../database', () => ({ getDb: () => ({ prepare: (sql: string) => ({
  get: () => sql.includes('session_realtime_timelines') ? { timeline_json: stored.timeline } : undefined,
}) }) }))
import { handleDetailCommand } from './detail-command'
import { setProgressiveSession, unsetProgressiveSession } from './progressive-session'

afterEach(() => unsetProgressiveSession('phone'))
it('opens deferred detail in a restored canonical Codex row outside the saved message page', () => {
  const message: ChatMessage = { id: 'provider-row', role: 'assistant', status: 'complete', providerId: 'codex', createdAt: '', content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items: [{ id: 'reason', type: 'reasoning', text: 'Inspect the login handlers' }] } } }
  stored.timeline = JSON.stringify({ hasTimeline: true, activeRealtimeSessionId: null, segments: [], threadMessages: [message] })
  setProgressiveSession('phone', 'voice')
  expect(handleDetailCommand({ type: 'subscribe_detail', sessionId: 'voice', projectPath: '/p',
    subscriptionId: 'detail', detailRef: '["provider-row","reasoning","reason"]' }, 'phone', undefined))
    .toMatchObject({ text: 'Inspect the login handlers', subscriptionId: 'detail' })
})

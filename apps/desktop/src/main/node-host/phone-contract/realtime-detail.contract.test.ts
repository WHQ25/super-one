import { afterEach, expect, it, vi } from 'vitest'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionLoadResult } from '@superone/shared/environment'

const { stored } = vi.hoisted(() => ({ stored: { timeline: '' } }))
vi.mock('../../database', () => ({ getDb: () => ({ prepare: (sql: string) => ({
  get: () => sql.includes('session_realtime_timelines') ? { timeline_json: stored.timeline } : undefined,
}) }) }))
vi.mock('../../logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } }))

import { loadRealtimeTimeline } from '../../session/realtime-timeline-repo'
import { connectPhone, phoneDomain } from '../phone-endpoint-test-fixtures'

const cleanup: Array<() => void> = []
afterEach(() => { while (cleanup.length) cleanup.pop()!() })

it.each(['lan', 'relay'] as const)('opens native detail in a stored canonical Codex row outside the saved page over %s', async transport => {
  const message: ChatMessage = { id: 'provider-row', role: 'assistant', status: 'complete', providerId: 'codex', createdAt: '', content: [],
    metadata: { codex: { threadId: 'thread', usage: null, items: [{ id: 'reason', type: 'reasoning', text: 'Inspect the login handlers' }] } } }
  stored.timeline = JSON.stringify({ hasTimeline: true, activeRealtimeSessionId: null, segments: [], threadMessages: [message] })
  const { domain, sessions, store } = phoneDomain(cleanup, { restore: { realtime: loadRealtimeTimeline } })
  store.rows.set('own', { ...store.rows.get('own')!, harnessId: 'codex' })
  sessions.live.delete('own')
  const phone = await connectPhone(domain, { transport })
  cleanup.push(phone.close)
  const loaded = await phone.rpc<SessionLoadResult>('session.load', { sessionId: 'own' })
  expect(loaded.messages).toEqual([])
  expect(loaded.restore?.realtimeThreadMessages?.map(row => row.id)).toEqual(['provider-row'])
  expect(JSON.stringify(loaded)).not.toContain('Inspect the login handlers')
  expect(await phone.rpc('session.subscribeDetail', { sessionId: 'own', subscriptionId: 'detail', detailRef: '["provider-row","reasoning","reason"]' }))
    .toMatchObject({ text: 'Inspect the login handlers', subscriptionId: 'detail' })
})

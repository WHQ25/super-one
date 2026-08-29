import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RealtimeTimelineResult } from '@superone/shared/agent-types'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))

vi.mock('../database', () => ({ getDb: getDbMock }))

import {
  applyRealtimeTimelineEvent,
  loadRealtimeTimeline,
  reconcileRealtimeTimeline,
} from './realtime-timeline-repo'

describe('realtime timeline repository', () => {
  let stored: string | null

  beforeEach(() => {
    stored = null
    getDbMock.mockReturnValue({
      prepare: vi.fn(() => ({
        get: vi.fn(() => stored ? { timeline_json: stored } : undefined),
        run: vi.fn((_sessionId: string, timelineJson: string) => { stored = timelineJson }),
      })),
    })
  })

  it('persists final transcript segments and closes the active realtime session', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_transcript', role: 'user', text: 'hello', final: false })
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_transcript', role: 'user', text: 'hello', final: true })
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_closed' })

    expect(loadRealtimeTimeline('sid-1')).toMatchObject({
      activeRealtimeSessionId: null,
      hasTimeline: true,
      segments: [{ realtimeSessionId: 'rt-1', role: 'user', text: 'hello' }],
    })
  })

  it('keeps a local final segment until the provider timeline publishes it', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_transcript', role: 'assistant', text: 'local reply', final: true })
    const provider: RealtimeTimelineResult = {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }

    expect(reconcileRealtimeTimeline('sid-1', provider).segments.map((segment) => segment.text))
      .toEqual(['local reply'])

    provider.segments.push({
      id: 'provider-1',
      realtimeSessionId: 'rt-1',
      role: 'assistant',
      text: 'local reply',
    })
    const reconciled = reconcileRealtimeTimeline('sid-1', provider)
    expect(reconciled.segments).toEqual(provider.segments)
    expect(loadRealtimeTimeline('sid-1')).toEqual(reconciled)
  })

  it('replaces one matching local segment even when its realtime session id differs', () => {
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript',
      role: 'assistant',
      text: ' local   reply ',
      final: true,
    })
    const provider: RealtimeTimelineResult = {
      segments: [{
        id: 'provider-1',
        realtimeSessionId: 'rt-1',
        role: 'assistant',
        text: 'local reply',
      }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }

    expect(reconcileRealtimeTimeline('sid-1', provider).segments).toEqual(provider.segments)
  })

  it('matches repeated transcripts one-to-one instead of dropping a new utterance', () => {
    const existing: RealtimeTimelineResult = {
      segments: [
        { id: 'provider-old', realtimeSessionId: 'rt-1', role: 'user', text: 'yes' },
        { id: 'local-new', realtimeSessionId: 'rt-2', role: 'user', text: 'yes' },
      ],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }
    stored = JSON.stringify(existing)
    const provider: RealtimeTimelineResult = {
      segments: [{ id: 'provider-old', realtimeSessionId: 'rt-1', role: 'user', text: 'yes' }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }

    expect(reconcileRealtimeTimeline('sid-1', provider).segments.map((segment) => segment.id))
      .toEqual(['provider-old', 'local-new'])
  })

  it('repairs duplicate canonical segment ids while loading a snapshot', () => {
    const duplicate = { id: 'provider-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello' }
    stored = JSON.stringify({
      segments: [duplicate, duplicate],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    })

    expect(loadRealtimeTimeline('sid-1')?.segments).toEqual([duplicate])
  })
})

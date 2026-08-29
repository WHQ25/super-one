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

  it('persists completed transcript items and closes the active realtime session', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'started', itemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: '',
    })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'delta', itemId: 'item-1', text: 'hello',
    })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello',
    })
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_closed' })

    expect(loadRealtimeTimeline('sid-1')).toMatchObject({
      activeRealtimeSessionId: null,
      hasTimeline: true,
      segments: [{ sourceItemId: 'item-1', realtimeSessionId: 'rt-1', role: 'user', text: 'hello' }],
    })
  })

  it('matches a split transcript by item id instead of its repeated text', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Right away',
    })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-2', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Right away',
    })
    const provider: RealtimeTimelineResult = {
      segments: [{ id: 'item-2', realtimeSessionId: 'rt-1', role: 'assistant', text: 'Right away' }],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }

    // Only the published half is consumed; the still-pending one survives as itself.
    expect(reconcileRealtimeTimeline('sid-1', provider).segments.map((segment) => segment.sourceItemId ?? segment.id))
      .toEqual(['item-2', 'item-1'])
  })

  it('keeps a local final segment until the provider timeline publishes it', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item', phase: 'completed', itemId: 'item-1', realtimeSessionId: 'rt-1', role: 'assistant', text: 'local reply',
    })
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

  it('keeps persisted lifecycle state when a provider snapshot races with it', () => {
    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_started', realtimeSessionId: 'rt-1', version: 'v3' })
    expect(reconcileRealtimeTimeline('sid-1', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: null,
      hasTimeline: true,
    }).activeRealtimeSessionId).toBe('rt-1')

    applyRealtimeTimelineEvent('sid-1', { type: 'realtime_closed' })
    expect(reconcileRealtimeTimeline('sid-1', {
      segments: [],
      threadMessages: [],
      activeRealtimeSessionId: 'rt-1',
      hasTimeline: true,
    }).activeRealtimeSessionId).toBeNull()
  })

  it('replaces one matching local segment even when its realtime session id differs', () => {
    applyRealtimeTimelineEvent('sid-1', {
      type: 'realtime_transcript_item',
      phase: 'completed',
      itemId: 'item-1',
      role: 'assistant',
      text: ' local   reply ',
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

/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { RealtimeTimelineSegment } from '@superone/shared/agent-types'
import { CodexRealtimeTimeline } from './CodexRealtimeTimeline'

const BASE = new Date('2026-08-29T10:15:00Z').getTime()

const segment = (
  id: string,
  role: 'user' | 'assistant',
  text: string,
  startedAtMs?: number,
): RealtimeTimelineSegment => ({
  id,
  realtimeSessionId: 'rt-1',
  role,
  text,
  ...(startedAtMs === undefined ? {} : { startedAtMs }),
})

describe('CodexRealtimeTimeline', () => {
  it('ticks each utterance with the time it started, relative to the call', () => {
    render(
      <CodexRealtimeTimeline
        segments={[
          segment('a', 'user', 'Set the pace first.', BASE),
          segment('b', 'assistant', 'Tightening the density.', BASE + 154_000),
        ]}
        speakingSegmentIds={new Set()}
      />,
    )

    expect(screen.getByText('00:00')).toBeInTheDocument()
    expect(screen.getByText('02:34')).toBeInTheDocument()
    expect(screen.getByText('Set the pace first.')).toBeInTheDocument()
    expect(screen.getByText('Codex')).toBeInTheDocument()
    expect(screen.getByText('You')).toBeInTheDocument()
  })

  it('marks the segment still being spoken', () => {
    render(
      <CodexRealtimeTimeline
        segments={[segment('a', 'user', 'Still deciding…', BASE)]}
        speakingSegmentIds={new Set(['a'])}
      />,
    )

    expect(screen.getByText('speaking')).toBeInTheDocument()
  })

  it('collapses a long pause into a silence marker', () => {
    render(
      <CodexRealtimeTimeline
        segments={[
          segment('a', 'user', 'One.', BASE),
          segment('b', 'user', 'Two.', BASE + 72_000),
        ]}
        speakingSegmentIds={new Set()}
      />,
    )

    expect(screen.getByText('Silent for 01:12')).toBeInTheDocument()
  })

  it('renders an unstamped transcript without any tick', () => {
    render(
      <CodexRealtimeTimeline
        segments={[segment('a', 'user', 'Recorded before stamping.')]}
        speakingSegmentIds={new Set()}
      />,
    )

    expect(screen.getByText('Recorded before stamping.')).toBeInTheDocument()
    expect(screen.queryByText('00:00')).not.toBeInTheDocument()
    expect(screen.queryByText(/Call started at/)).not.toBeInTheDocument()
  })
})

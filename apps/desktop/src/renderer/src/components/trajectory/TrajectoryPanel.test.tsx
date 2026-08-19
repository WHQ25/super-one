/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TrajectoryProjection, TrajectoryResult } from '@superone/shared/trajectory-types'
import { TrajectoryPanel } from './TrajectoryPanel'

// jsdom has no layout, so the real virtualizer would render zero rows.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 26,
    getVirtualItems: () => Array.from({ length: count }, (_, index) => ({
      key: index, index, start: index * 26, size: 26,
    })),
    measureElement: () => {},
  }),
}))

const TRAJECTORY: TrajectoryProjection = {
  sessionId: 's1',
  live: false,
  dropped: 0,
  totals: { input: 120, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  turns: [{ turn: 1, startedAt: 1_000, durationMs: 900, outcome: 'completed', steps: 1, toolCalls: 1 }],
  requests: [{
    ordinal: 1,
    seq: 2,
    purpose: 'generation',
    turn: 1,
    step: 1,
    startedAt: 1_000,
    durationMs: 900,
    ttftMs: 200,
    usage: { input: 120, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
    route: { provider: 'deepseek', model: 'deepseek-chat', contextWindow: 128_000 },
    header: 0,
  }],
  headers: [{
    index: 0,
    seq: 1,
    time: 900,
    reason: 'change',
    config: { provider: 'deepseek', model: 'deepseek-chat' },
    adapterDefaults: null,
    system: { text: 'you are a careful engineer' },
    tools: [{ name: 'read', description: 'read a file', parameters: { type: 'object' } }],
  }],
  records: [
    {
      id: 'system:1',
      index: 1,
      kind: 'system',
      seq: 1,
      turn: 1,
      step: 1,
      request: 1,
      startedAt: 900,
      durationMs: null,
      summary: 'prompt updated · deepseek-chat · 1 tools',
      header: 0,
      change: {
        config: [{ field: 'model', before: 'deepseek-reasoner', after: 'deepseek-chat' }],
        systemChanged: true,
        systemHunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['-you are helpful', '+you are a careful engineer'] }],
        toolsAdded: ['read'],
        toolsRemoved: [],
        toolsChanged: [],
      },
    },
    {
      id: 'tool:call-1',
      index: 2,
      kind: 'tool',
      seq: 4,
      turn: 1,
      step: 1,
      request: 1,
      startedAt: 1_200,
      durationMs: 500,
      summary: 'read {"path":"a.ts"}',
      name: 'read',
      callId: 'call-1',
      args: { text: '{"path":"a.ts"}' },
      result: { text: 'file contents' },
      schema: { name: 'read', description: 'read a file', parameters: { type: 'object' } },
      isError: false,
      error: null,
    },
  ],
}

const readTrajectory = vi.fn<(sessionId: string) => Promise<TrajectoryResult>>()

beforeEach(() => {
  readTrajectory.mockReset()
  readTrajectory.mockResolvedValue({ ok: true, trajectory: TRAJECTORY })
  Object.assign(window, {
    app: { readDeepseekTrajectory: readTrajectory },
    agent: { onAgentEvent: () => () => {} },
  })
})

describe('TrajectoryPanel', () => {
  it('renders the turn boundary and every record in the loaded window', async () => {
    render(<TrajectoryPanel sessionId="s1" />)

    expect(await screen.findByText('Turn 1')).toBeInTheDocument()
    expect(screen.getByText('1 steps · 1 calls')).toBeInTheDocument()
    expect(screen.getByText('read {"path":"a.ts"}')).toBeInTheDocument()
    expect(screen.getByText('1 requests')).toBeInTheDocument()
  })

  it('opens the call-time schema for a selected tool record', async () => {
    render(<TrajectoryPanel sessionId="s1" />)
    await userEvent.click(await screen.findByText('read {"path":"a.ts"}'))

    // Arguments open first; the schema is the tab that answers "what was this
    // tool advertised as when the model chose it".
    expect(screen.getByText(/"path": "a.ts"/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Schema' }))
    expect(await screen.findByText('read a file')).toBeInTheDocument()
  })

  it('shows what a request-header snapshot changed', async () => {
    render(<TrajectoryPanel sessionId="s1" />)
    await userEvent.click(await screen.findByText('prompt updated · deepseek-chat · 1 tools'))

    // `changes` leads for a snapshot that superseded another — the diff is the
    // reason that record is interesting at all.
    expect(await screen.findByText('deepseek-reasoner')).toBeInTheDocument()
    expect(screen.getByText('-you are helpful')).toBeInTheDocument()
    expect(screen.getByText('+you are a careful engineer')).toBeInTheDocument()
  })

  it('reports a read failure with the backend text and a way to retry', async () => {
    readTrajectory.mockResolvedValue({ ok: false, reason: 'error', error: 'zstd frame is corrupt' })
    render(<TrajectoryPanel sessionId="s1" />)

    expect(await screen.findByText('Could Not Read the Session Log')).toBeInTheDocument()
    expect(screen.getByText('zstd frame is corrupt')).toBeInTheDocument()

    // Retrying has to actually re-read: a dead end is what made the previous
    // one-line error unhelpful.
    readTrajectory.mockResolvedValue({ ok: true, trajectory: TRAJECTORY })
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText('Turn 1')).toBeInTheDocument()
  })

  it('says a fresh session has no trajectory yet rather than reporting an error', async () => {
    readTrajectory.mockResolvedValue({ ok: false, reason: 'absent' })
    render(<TrajectoryPanel sessionId="s1" />)

    expect(await screen.findByText('No Trajectory Yet')).toBeInTheDocument()
    // The backend's `session "…" not found` must not reach the user: nothing
    // is wrong, the session simply has not run.
    expect(screen.queryByText(/not found/)).not.toBeInTheDocument()
    expect(screen.queryByText('Could Not Read the Session Log')).not.toBeInTheDocument()
  })
})

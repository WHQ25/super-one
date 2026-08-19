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
    scrollToIndex: () => {},
  }),
}))

const TRAJECTORY: TrajectoryProjection = {
  sessionId: 's1',
  live: false,
  firstIndex: 1,
  total: 2,
  cursor: 9,
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

const readTrajectory = vi.fn<(sessionId: string, cursor?: number) => Promise<TrajectoryResult>>()
const readPage = vi.fn()
const watchTrajectory = vi.fn().mockResolvedValue({ ok: true })
/** The main-process push the panel follows, captured by the mocked bridge. */
let notifyChanged: ((sessionId: string) => void) | null = null
const readPayload = vi.fn()
const saveTextAs = vi.fn()

beforeEach(() => {
  readTrajectory.mockReset()
  readTrajectory.mockResolvedValue({ ok: true, kind: 'full', trajectory: TRAJECTORY })
  Object.assign(window, {
    app: {
      readDeepseekTrajectory: readTrajectory,
      readDeepseekTrajectoryPage: readPage,
      readDeepseekTrajectoryPayload: readPayload,
      saveTextAs,
      watchDeepseekTrajectory: watchTrajectory,
      onDeepseekTrajectoryChanged: (callback: (sessionId: string) => void) => {
        notifyChanged = callback
        return () => { notifyChanged = null }
      },
    },
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
    readTrajectory.mockResolvedValue({ ok: true, kind: 'full', trajectory: TRAJECTORY })
    await userEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    expect(await screen.findByText('Turn 1')).toBeInTheDocument()
  })

  it('inspects a model call as itself when its boundary row is selected', async () => {
    render(<TrajectoryPanel sessionId="s1" />)
    await userEvent.click(await screen.findByText('Request #1'))

    // The call's options are the prompt-time facts no single record carries.
    expect(await screen.findByRole('tab', { name: 'Options' })).toBeInTheDocument()
    expect(screen.getByText('Reasoning Effort')).toBeInTheDocument()
    expect(screen.getByText('Temperature')).toBeInTheDocument()
  })

  it('reads an earlier page and keeps the loaded window numbered from the fold', async () => {
    readTrajectory.mockResolvedValue({
      ok: true,
      kind: 'full',
      trajectory: { ...TRAJECTORY, firstIndex: 4, total: 5 },
    })
    readPage.mockResolvedValue({
      ok: true,
      page: {
        firstIndex: 3,
        records: [{ ...TRAJECTORY.records[0]!, id: 'user:0', index: 3, kind: 'user', summary: 'earlier prompt', content: { text: 'earlier prompt' }, blocks: [] }],
      },
    })
    render(<TrajectoryPanel sessionId="s1" />)

    // Both the timeline's truncation control and the ledger's head row reach
    // the same page; the ledger's is the one a scrolling user meets.
    const entries = await screen.findAllByRole('button', { name: 'Load earlier records' })
    await userEvent.click(entries[entries.length - 1]!)
    expect(await screen.findByText('earlier prompt')).toBeInTheDocument()
    expect(readPage).toHaveBeenCalledWith('s1', 4, expect.any(Number))
  })

  it('polls with its cursor and merges the revision a completed call sends back', async () => {
    const running = {
      ...TRAJECTORY,
      records: TRAJECTORY.records.map((record) =>
        (record.kind === 'tool' ? { ...record, result: null, durationMs: null } : record)),
    }
    readTrajectory.mockResolvedValue({ ok: true, kind: 'full', trajectory: running })
    render(<TrajectoryPanel sessionId="s1" />)
    await userEvent.click(await screen.findByText('read {"path":"a.ts"}'))
    expect(await screen.findByRole('tab', { name: 'Result' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Result' }))
    expect(screen.getByText('Still running.')).toBeInTheDocument()
  })

  it('follows the session log rather than the agent event stream', async () => {
    render(<TrajectoryPanel sessionId="s1" />)
    await screen.findByText('Turn 1')
    // Watching starts with the panel and ends with it, so the main process
    // notifies nobody once the tab is closed.
    expect(watchTrajectory).toHaveBeenCalledWith('s1', true)

    // A record with no agent-event counterpart — an injected context snapshot —
    // still reaches the ledger, because the push comes off the log.
    readTrajectory.mockResolvedValue({
      ok: true,
      kind: 'delta',
      delta: {
        cursor: 12,
        records: [{
          id: 'context:9',
          index: 3,
          kind: 'context',
          seq: 9,
          turn: 1,
          step: null,
          request: null,
          startedAt: 3_000,
          durationMs: null,
          summary: 'AGENTS.md loaded',
          content: { text: 'AGENTS.md' },
          blocks: [],
          producer: 'dsh-agents-md',
          form: 'instructions',
          notice: null,
          sections: null,
        }],
        headers: [],
        requests: [],
        turns: [],
        totals: TRAJECTORY.totals,
        total: 3,
        live: true,
      },
    })
    notifyChanged?.('s1')

    expect(await screen.findByText('AGENTS.md loaded')).toBeInTheDocument()
    expect(readTrajectory).toHaveBeenLastCalledWith('s1', 9)
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

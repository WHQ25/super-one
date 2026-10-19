import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatMessage, ContentBlock } from '@superone/shared/agent-types'
import { windowBudget } from '@superone/shared/transcript-window/select-window'
import { WindowViews } from '@superone/runtime/stream/delivery/window-views'
import type { DesktopSessionRow } from '../db-remote-controlled-sessions'
import { serializeMessageContent } from '../session/session-repo'
import { openColdTranscript } from '../session/cold-transcript'
import { DesktopSessionReads } from './desktop-session-reads'

const { getDbMock } = vi.hoisted(() => ({ getDbMock: vi.fn() }))
vi.mock('../database', () => ({ getDb: getDbMock }))

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  getDbMock.mockReturnValue(db)
  db.exec(`
    CREATE TABLE chat_messages (
      id TEXT, session_id TEXT, sort_order INTEGER, role TEXT, status TEXT, content_json TEXT,
      created_at TEXT, provider_id TEXT, metadata_json TEXT, checkpoint_id TEXT, resume_point_id TEXT
    );
  `)
})

afterEach(() => { db.close() })

function row(sessionId: string): DesktopSessionRow {
  return {
    sessionId, projectId: 'p1', projectPath: '/work/app', title: sessionId, harnessId: 'claude', providerId: 'claude',
    providerSessionId: null, worktreePath: null, isPinned: false, isHidden: false, isUserRenamed: false, tags: [],
    createdAt: 0, updatedAt: 0, controller: null,
  }
}

class Reads extends DesktopSessionReads<DesktopSessionRow> {}

function message(id: string, content: ContentBlock[], role: ChatMessage['role'] = 'assistant'): ChatMessage {
  return { id, role, status: 'complete', content, createdAt: '2026-10-13T00:00:00.000Z', providerId: 'claude' }
}

function insert(sessionId: string, messages: ChatMessage[], sortOrders?: number[]) {
  const stmt = db.prepare(`
    INSERT INTO chat_messages (id, session_id, sort_order, role, status, content_json, created_at, provider_id, metadata_json, checkpoint_id, resume_point_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
  `)
  messages.forEach((entry, index) => {
    stmt.run(entry.id, sessionId, sortOrders?.[index] ?? index, entry.role, entry.status, serializeMessageContent(entry), entry.createdAt, entry.providerId, entry.metadata ? JSON.stringify(entry.metadata) : null)
  })
}

const todo = message('todo', [{
  type: 'tool_use', toolUseId: 'todo-tool', toolName: 'TodoWrite', status: 'complete',
  input: JSON.stringify({ todos: [{ content: 'older than the window', status: 'pending' }] }),
}])
const question = message('q', [{ type: 'text', id: 'item-1', text: 'which?', codexAsyncQuestions: [{ title: 'Ship?', options: ['yes'] }] }])
const app = message('app', [{
  type: 'tool_use', toolUseId: 'app-tool', toolName: 'mcp', status: 'complete', input: '{}',
  app: {
    appInstanceId: 'view',
    binding: { node: 'node', session: 's', server: 'fixture', configGeneration: 0, configFingerprint: 'config' },
    resourceUri: 'ui://fixture/view', status: 'result',
    modelContext: { updateId: 'rev', content: [{ type: 'text', text: 'kept' }] },
  },
} as ContentBlock])

function reads(options: { live?: { snapshot: { messages: ChatMessage[]; harnessId: string }; [key: string]: unknown } | null; loadMessages?: () => never } = {}) {
  return new Reads({
    environmentId: 'desktop',
    sessions: {
      getSession: () => options.live ?? null,
      onSession: () => () => {},
    } as never,
    rows: {
      get: (id: string) => id === 's' ? row('s') : null,
      list: () => [],
      loadMessages: options.loadMessages ?? (() => { throw new Error('paged load') }),
    },
    events: { headSequence: () => '11', epoch: 'epoch', sessionVersion: () => 5 } as never,
  })
}

describe('cold transcript window', () => {
  it('reports the real total, pages to the first message, and restores state outside the window', async () => {
    const fillers = Array.from({ length: 210 }, (_, index) => message(`f${index}`, [{ type: 'text', text: `note ${index}` }], 'user'))
    const tail = message('tail', [{ type: 'text', text: 'x'.repeat(20_000) }])
    insert('s', [question, todo, app, ...fillers, tail])
    let paged = false
    const opened = await reads({ loadMessages: () => { paged = true; throw new Error('paged load') } }).readTranscriptWindow({
      sessionId: 's',
      includeState: true,
      read: (view) => {
        const views = new WindowViews()
        const budget = windowBudget({})
        const tailWindow = views.serve({ sessionId: 's', holder: 'phone', transcript: view.transcript, request: {}, budget })
        const parsed = view.transcript.parsed?.() ?? 0
        const seen = new Set(tailWindow.messages.map((entry) => entry.id))
        let older = tailWindow.older
        let guard = 0
        while (older && guard++ < 20) {
          const page = views.serve({ sessionId: 's', holder: 'phone', transcript: view.transcript, request: { anchor: older, direction: 'before' }, budget })
          for (const entry of page.messages) seen.add(entry.id)
          older = page.older
        }
        return { tailWindow, parsed, seen: [...seen], older, state: view.state, restore: view.restore, cursor: view.cursor }
      },
    })
    expect(paged).toBe(false)
    expect(opened.tailWindow.total).toBe(214)
    expect(opened.tailWindow.messages.map((entry) => entry.id)).toEqual(['tail'])
    expect(opened.tailWindow.messages[0]?.index).toBe(213)
    expect(opened.parsed).toBeLessThanOrEqual(opened.tailWindow.messages.length + 1)
    expect(opened.parsed).toBeLessThan(10)
    expect(opened.seen).toContain('q')
    expect(opened.older).toBeNull()
    expect(opened.state.todos).toMatchObject({ '1': { subject: 'older than the window', status: 'pending' } })
    expect(opened.state.pendingAsyncQuestions).toMatchObject([{ messageId: 'q', item: { id: 'item-1' } }])
    expect(opened.restore?.mcpAppContexts).toMatchObject([{ messageId: 'app', app: { appInstanceId: 'view' } }])
    expect(opened.cursor).toEqual({ sequence: '11', epoch: 'epoch', version: 5 })
  })

  it('drops a TodoWrite that a later task tool replaced, and an answered async question', async () => {
    const task = message('task', [{ type: 'tool_use', toolUseId: 'task-tool', toolName: 'TaskCreate', status: 'complete', input: '{}' }])
    const answer = message('codex_async_answer:item-1', [{ type: 'text', text: 'yes' }], 'user')
    insert('s', [question, todo, answer, task, message('tail', [{ type: 'text', text: 'end' }])])
    const opened = await reads().readTranscriptWindow({
      sessionId: 's',
      includeState: true,
      read: (view) => view.state,
    })
    expect(opened.todos).toEqual({})
    expect(opened.pendingAsyncQuestions).toEqual([])
  })

  it('expands a cold row older than the newest stored page by id', () => {
    const fillers = Array.from({ length: 250 }, (_, index) => message(`f${index}`, [{ type: 'text', text: `note ${index}` }]))
    insert('s', fillers)
    const host = new Reads({
      environmentId: 'desktop',
      sessions: { getSession: () => null, onSession: () => () => {} } as never,
      rows: {
        get: (id: string) => id === 's' ? row('s') : null,
        list: () => [],
        // The stored page stops at the newest 200 rows.
        loadMessages: () => ({ messages: fillers.slice(-200), cursor: 50, hasMore: true }),
        loadMessage: (_sessionId: string, id: string) => fillers.find((entry) => entry.id === id) ?? null,
      },
      events: { headSequence: () => '1', epoch: 'e', sessionVersion: () => 1 } as never,
    })
    expect(host.messages('s').some((entry) => entry.id === 'f3')).toBe(false)
    expect(host.detailMessage('s', 'f3')?.id).toBe('f3')
    expect(host.detailMessage('s', 'missing')).toBeNull()
  })

  it('locates an anchor by sort order when the order has gaps', () => {
    insert('s', [message('a', [{ type: 'text', text: 'a' }]), message('b', [{ type: 'text', text: 'b' }]), message('c', [{ type: 'text', text: 'c' }])], [10, 20, 40])
    const transcript = openColdTranscript('s')
    expect(transcript.count).toBe(3)
    expect(transcript.indexOf('c')).toBe(2)
    expect(transcript.indexOf('missing')).toBe(-1)
    expect(transcript.messageAt(0).id).toBe('a')
    expect(transcript.messageAt(2).id).toBe('c')
    expect(transcript.parsed?.()).toBe(2)
  })

  it('reads a live snapshot without the stored page, and skips prepare when state is omitted', async () => {
    const messages = [question, message('tail', [{ type: 'text', text: 'now' }])]
    let prepared = 0
    let paged = false
    const live = {
      snapshot: { messages, harnessId: 'claude', isWorktree: false, worktreePath: null, gitBranch: null, worktreeMissing: false, contextTokens: 0, totalCostUsd: 0 },
      getReplayEvents: () => [],
      getPendingInteractions: () => [],
      cwd: '/work/app',
      isStreaming: () => false,
      getCurrentPermissionMode: () => 'ask',
      getCurrentSandboxInfo: () => ({ enabled: false }),
      getUiSettings: () => ({ ultracode: false }),
      getSessionGoal: () => null,
      getApiProviderId: () => null,
    }
    const host = new Reads({
      environmentId: 'desktop',
      restore: { prepare: async () => { prepared += 1; return undefined } },
      sessions: { getSession: () => live, onSession: () => () => {} } as never,
      rows: { get: () => row('s'), list: () => [], loadMessages: () => { paged = true; return { messages: [], cursor: null, hasMore: false } } },
      events: { headSequence: () => '1', epoch: 'e', sessionVersion: () => 2 } as never,
    })
    const opened = await host.readTranscriptWindow({
      sessionId: 's',
      includeState: true,
      read: (view) => {
        const selected = new WindowViews().serve({ sessionId: 's', holder: 'phone', transcript: view.transcript, request: {}, budget: windowBudget({}) })
        return { total: selected.total, ids: selected.messages.map((entry) => entry.id), pending: view.state.pendingAsyncQuestions }
      },
    })
    expect(prepared).toBe(1)
    expect(paged).toBe(false)
    expect(opened.total).toBe(2)
    expect(opened.ids).toEqual(['q', 'tail'])
    expect(opened.pending).toMatchObject([{ messageId: 'q' }])
    prepared = 0
    await host.readTranscriptWindow({ sessionId: 's', includeState: false, read: (view) => view.state })
    expect(prepared).toBe(0)
  })
})

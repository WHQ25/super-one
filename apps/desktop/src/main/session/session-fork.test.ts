import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChatMessage } from '@superone/shared/agent-types'
import type { SessionRecord } from './session-repo'

const { getSessionRecordMock, loadSessionStateBySidMock, forkSessionRecordMock, sdkForkSessionMock, withAppServerRequestMock } = vi.hoisted(() => ({
  getSessionRecordMock: vi.fn(),
  loadSessionStateBySidMock: vi.fn(),
  forkSessionRecordMock: vi.fn(),
  sdkForkSessionMock: vi.fn(),
  withAppServerRequestMock: vi.fn(),
}))

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ forkSession: sdkForkSessionMock }))
vi.mock('../codex/codex-experiment-service', () => ({
  getSharedCodexService: () => ({ withAppServerRequest: withAppServerRequestMock }),
}))
vi.mock('./session-repo', () => ({
  getSessionRecord: getSessionRecordMock,
  loadSessionStateBySid: loadSessionStateBySidMock,
  forkSessionRecord: forkSessionRecordMock,
}))
// Stub the backend classes so the real harness registry loads without pulling
// in the heavy Electron-laden backend modules — fork never instantiates them.
vi.mock('./backends/claude-backend', () => ({ ClaudeBackend: class {} }))
vi.mock('./backends/codex-backend', () => ({ CodexBackend: class {} }))

import { forkSession } from './session-fork'

let tmpRoot: string
let configDir: string
let projectPath: string

function makeRecord(over: Partial<SessionRecord>): SessionRecord {
  return {
    id: 's-src', projectPath, projectId: 'p1', providerId: 'claude-base',
    harnessId: 'claude', providerSessionId: 'provider-src', title: 'Source',
    isWorktree: false, gitBranch: null, worktreePath: null, isPinned: false,
    isHidden: false, totalCostUsd: 0, contextTokens: 0, createdAt: '', lastUserMessageAt: null,
    apiProviderId: null, ...over,
  }
}

function msg(id: string, role: 'user' | 'assistant', over: Partial<ChatMessage> = {}): ChatMessage {
  return { id, role, status: 'complete', content: [], createdAt: '', providerId: 'p', ...over }
}

function setupSource(record: SessionRecord, messages: ChatMessage[]) {
  getSessionRecordMock.mockReturnValue(record)
  loadSessionStateBySidMock.mockReturnValue({ record, messages })
}

beforeEach(() => {
  vi.clearAllMocks()
  tmpRoot = mkdtempSync(join(tmpdir(), 'fork-test-'))
  configDir = join(tmpRoot, 'config')
  projectPath = join(tmpRoot, 'repo')
  mkdirSync(projectPath, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = configDir
})

afterEach(() => {
  delete process.env.CLAUDE_CONFIG_DIR
  rmSync(tmpRoot, { recursive: true, force: true })
})

function stubClaudeSdkFork() {
  sdkForkSessionMock.mockImplementation(async () => {
    const dir = join(configDir, 'projects', 'src-slug')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'claude-forked.jsonl'), '{}')
    return { sessionId: 'claude-forked' }
  })
}

describe('forkSession harness dispatch', () => {
  it('forks a Claude session, resolving upToMessageId from the selected turn anchor', async () => {
    setupSource(makeRecord({ harnessId: 'claude', providerSessionId: 'claude-src' }), [
      msg('u1', 'user'),
      msg('a1', 'assistant', { metadata: { forkAnchorId: 'anchor-a1' } }),
      msg('u2', 'user'),
      msg('a2', 'assistant', { metadata: { forkAnchorId: 'anchor-a2' } }),
    ])
    stubClaudeSdkFork()

    const result = await forkSession({ sessionId: 's-src', mode: 'local', forkFromMessageId: 'a1' })

    expect(result.ok).toBe(true)
    expect(sdkForkSessionMock).toHaveBeenCalledWith('claude-src', { upToMessageId: 'anchor-a1' })
    expect(forkSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'claude-forked', forkFromMessageId: 'a1' }),
    )
  })

  it('full-copies a Claude session without loading the transcript when no fork message is given', async () => {
    setupSource(makeRecord({ harnessId: 'claude', providerSessionId: 'claude-src' }), [])
    stubClaudeSdkFork()

    await forkSession({ sessionId: 's-src', mode: 'local' })

    expect(sdkForkSessionMock).toHaveBeenCalledWith('claude-src', undefined)
    expect(loadSessionStateBySidMock).not.toHaveBeenCalled()
  })

  it('forks a Codex session through the anchor turnId in a single thread/fork call', async () => {
    setupSource(makeRecord({ harnessId: 'codex', providerId: 'codex-base', providerSessionId: 'thread-src' }), [
      msg('u1', 'user'), msg('a1', 'assistant', { metadata: { codex: { threadId: null, turnId: 'turn-a1', usage: null, items: [] } } }),
      msg('u2', 'user'), msg('a2', 'assistant', { metadata: { codex: { threadId: null, turnId: 'turn-a2', usage: null, items: [] } } }),
      msg('u3', 'user'), msg('a3', 'assistant'),
    ])
    const calls: Array<[string, unknown]> = []
    withAppServerRequestMock.mockImplementation(async (_p: string, fn: (r: unknown) => Promise<unknown>) => {
      const request = vi.fn(async (method: string, params: unknown) => {
        calls.push([method, params])
        return method === 'thread/fork' ? { thread: { id: 'thread-forked' } } : {}
      })
      return fn(request)
    })

    const result = await forkSession({ sessionId: 's-src', mode: 'local', forkFromMessageId: 'a1' })

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      ['thread/fork', { threadId: 'thread-src', lastTurnId: 'turn-a1' }],
    ])
    expect(forkSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-forked', forkFromMessageId: 'a1' }),
    )
  })

  it('falls back to deprecated fork+rollback when the anchor message has no persisted turnId', async () => {
    setupSource(makeRecord({ harnessId: 'codex', providerId: 'codex-base', providerSessionId: 'thread-src' }), [
      msg('u1', 'user'), msg('a1', 'assistant'),
      msg('u2', 'user'), msg('a2', 'assistant'),
      msg('u3', 'user'), msg('a3', 'assistant'),
    ])
    const calls: Array<[string, unknown]> = []
    withAppServerRequestMock.mockImplementation(async (_p: string, fn: (r: unknown) => Promise<unknown>) => {
      const request = vi.fn(async (method: string, params: unknown) => {
        calls.push([method, params])
        return method === 'thread/fork' ? { thread: { id: 'thread-forked' } } : {}
      })
      return fn(request)
    })

    const result = await forkSession({ sessionId: 's-src', mode: 'local', forkFromMessageId: 'a1' })

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      ['thread/fork', { threadId: 'thread-src' }],
      ['thread/rollback', { threadId: 'thread-forked', numTurns: 2 }],
    ])
    expect(forkSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-forked', forkFromMessageId: 'a1' }),
    )
  })

  it('full-copies a Codex session without loading the transcript when no fork message is given', async () => {
    setupSource(makeRecord({ harnessId: 'codex', providerId: 'codex-base', providerSessionId: 'thread-src' }), [])
    const methods: string[] = []
    withAppServerRequestMock.mockImplementation(async (_p: string, fn: (r: unknown) => Promise<unknown>) => {
      const request = vi.fn(async (method: string) => {
        methods.push(method)
        return method === 'thread/fork' ? { thread: { id: 'thread-forked' } } : {}
      })
      return fn(request)
    })

    await forkSession({ sessionId: 's-src', mode: 'local' })

    expect(methods).toEqual(['thread/fork'])
    expect(loadSessionStateBySidMock).not.toHaveBeenCalled()
  })
})

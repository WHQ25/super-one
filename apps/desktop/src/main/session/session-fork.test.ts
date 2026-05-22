import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionRecord } from './session-repo'

const { getSessionRecordMock, forkSessionRecordMock, sdkForkSessionMock, withAppServerRequestMock } = vi.hoisted(() => ({
  getSessionRecordMock: vi.fn(),
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
  forkSessionRecord: forkSessionRecordMock,
}))

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

describe('forkSession truncation', () => {
  it('passes upToMessageId to the Claude SDK forkSession', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({ providerId: 'claude-base', providerSessionId: 'claude-src' }))
    sdkForkSessionMock.mockImplementation(async () => {
      const dir = join(configDir, 'projects', 'src-slug')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'claude-forked.jsonl'), '{}')
      return { sessionId: 'claude-forked' }
    })

    const result = await forkSession({ sessionId: 's-src', mode: 'local', upToMessageId: 'asst-uuid-9' })

    expect(result.ok).toBe(true)
    expect(sdkForkSessionMock).toHaveBeenCalledWith('claude-src', { upToMessageId: 'asst-uuid-9' })
    expect(forkSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'claude-forked' }),
    )
  })

  it('full-copies a Claude session when upToMessageId is omitted', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({ providerId: 'claude-base', providerSessionId: 'claude-src' }))
    sdkForkSessionMock.mockImplementation(async () => {
      const dir = join(configDir, 'projects', 'src-slug')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'claude-forked.jsonl'), '{}')
      return { sessionId: 'claude-forked' }
    })

    await forkSession({ sessionId: 's-src', mode: 'local' })

    expect(sdkForkSessionMock).toHaveBeenCalledWith('claude-src', undefined)
  })

  it('forks a Codex session via thread/fork then rolls back trailing turns', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({
      providerId: 'codex-base', harnessId: 'codex', providerSessionId: 'thread-src',
    }))
    const calls: Array<[string, unknown]> = []
    withAppServerRequestMock.mockImplementation(async (_projectPath: string, fn: (r: unknown) => Promise<unknown>) => {
      const request = vi.fn(async (method: string, params: unknown) => {
        calls.push([method, params])
        return method === 'thread/fork' ? { thread: { id: 'thread-forked' } } : {}
      })
      return fn(request)
    })

    const result = await forkSession({ sessionId: 's-src', mode: 'local', dropTrailingTurns: 2 })

    expect(result.ok).toBe(true)
    expect(calls).toEqual([
      ['thread/fork', { threadId: 'thread-src' }],
      ['thread/rollback', { threadId: 'thread-forked', numTurns: 2 }],
    ])
    expect(forkSessionRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerSessionId: 'thread-forked' }),
    )
  })

  it('skips thread/rollback when no trailing turns are dropped', async () => {
    getSessionRecordMock.mockReturnValue(makeRecord({
      providerId: 'codex-base', harnessId: 'codex', providerSessionId: 'thread-src',
    }))
    const methods: string[] = []
    withAppServerRequestMock.mockImplementation(async (_projectPath: string, fn: (r: unknown) => Promise<unknown>) => {
      const request = vi.fn(async (method: string) => {
        methods.push(method)
        return method === 'thread/fork' ? { thread: { id: 'thread-forked' } } : {}
      })
      return fn(request)
    })

    await forkSession({ sessionId: 's-src', mode: 'local' })

    expect(methods).toEqual(['thread/fork'])
  })
})

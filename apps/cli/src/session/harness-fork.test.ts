import { describe, expect, it, vi } from 'vitest'
import { forkNodeHarnessResume } from './harness-fork'
import type { NodeSessionRecord } from '@superone/runtime/session'

function session(overrides?: Partial<NodeSessionRecord>): NodeSessionRecord {
  return {
    sessionId: 's1',
    projectId: 'p1',
    harnessId: 'claude',
    providerId: 'claude',
    title: 'T',
    status: 'idle',
    transcript: [{ id: 'u1', role: 'user', text: 'hi', createdAt: 1 }],
    pendingInteraction: null,
    providerResume: 'claude-session:src-sdk',
    cwd: null,
    createdAt: 0,
    updatedAt: 0,
    isPinned: false,
    isHidden: false,
    controllerClientSessionId: null,
    hostActionCapabilityVersion: 0,
    hostActionToolGroups: [],
    ...overrides,
  }
}

describe('forkNodeHarnessResume', () => {
  it('forks Claude via SDK and returns claude-session: prefix', async () => {
    const forkClaudeFn = vi.fn(async () => 'new-sdk-id')
    const resume = await forkNodeHarnessResume(session(), '/work/app', {
      resolveProjectPath: () => '/work/app',
      forkClaudeFn: forkClaudeFn as never,
    })
    expect(resume).toBe('claude-session:new-sdk-id')
    expect(forkClaudeFn).toHaveBeenCalledWith(
      expect.objectContaining({
        providerSessionId: 'src-sdk',
        targetCwd: '/work/app',
      }),
    )
  })

  it('forks Codex thread via openCodex + thread/fork', async () => {
    const request = vi.fn(async (method: string) => {
      if (method === 'thread/fork') return { thread: { id: 'thread-forked' } }
      return {}
    })
    const close = vi.fn(async () => {})
    const openCodexFn = vi.fn(async () => ({
      request,
      notify: vi.fn(),
      nextNotification: vi.fn(),
      close,
      getStderrRedacted: () => '',
    }))
    const resume = await forkNodeHarnessResume(
      session({ harnessId: 'codex', providerId: 'codex', providerResume: 'thread:t-src' }),
      '/work/wt',
      {
        resolveProjectPath: () => '/work/app',
        openCodexFn: openCodexFn as never,
        codexBinaryPath: '/bin/codex',
      },
    )
    expect(resume).toBe('thread:thread-forked')
    expect(request).toHaveBeenCalledWith('thread/fork', { threadId: 't-src' })
    expect(close).toHaveBeenCalled()
  })

  it('returns null when no providerResume', async () => {
    const resume = await forkNodeHarnessResume(
      session({ providerResume: null }),
      '/work/app',
      { resolveProjectPath: () => '/work/app' },
    )
    expect(resume).toBeNull()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, ChatMessage } from '@superone/shared/agent-types'
import { applySuggestedTaskUpdate } from '@superone/shared/suggested-task'

const mocks = vi.hoisted(() => ({
  createGrants: vi.fn(),
  startSessionAgent: vi.fn(),
  grantForLaunch: vi.fn(),
  resolveMainWorktreeDir: vi.fn(),
}))

vi.mock('./session-collaboration', () => ({
  createGrants: mocks.createGrants,
  startSessionAgent: mocks.startSessionAgent,
}))
vi.mock('./collaboration-mailbox', () => ({ collaborationStore: () => ({ grantForLaunch: mocks.grantForLaunch }) }))
vi.mock('./agent-profiles', () => ({
  listSessionAgentProfiles: () => [{ id: 'claude-base', defaultConfig: { sandboxMode: 'off', model: 'default-model' } }],
}))
vi.mock('./collaboration-child-project', () => ({
  resolveCwd: (config: { cwd?: string }, parent: { cwd: string }) => config.cwd ?? parent.cwd,
}))
vi.mock('./collaboration-host', () => ({
  resolveLiveSession: (host: { getSession: (id: string) => unknown }, id: string) => host.getSession(id),
}))
vi.mock('../git/worktree-ops', () => ({ resolveMainWorktreeDir: mocks.resolveMainWorktreeDir }))

import {
  SuggestedTaskError,
  dismissSuggestedTask,
  launchSuggestedTask,
  suggestedTaskBranchName,
  suggestedTaskReply,
} from './suggested-task'

const TASK_ID = '0b9f3c1e-2a4d-4e5f-8a6b-7c8d9e0f1a2b'
const INPUT = { title: 'Fix the flaky login test', tldr: 'It times out on CI.', prompt: '## Task\nFix it.' }

function transcript(input: Record<string, unknown> = INPUT): ChatMessage[] {
  return [{
    id: 'a1',
    role: 'assistant',
    content: [
      { type: 'tool_use', toolName: 'mcp__superone__session_suggest_task', toolUseId: 'call-1', input: JSON.stringify(input) },
      { type: 'tool_result', toolUseId: 'call-1', summary: JSON.stringify({ taskId: TASK_ID, status: 'pending' }) },
    ],
  }] as ChatMessage[]
}

/** A session whose host events go through the same reducer as the real one. */
function fakeSession(messages = transcript()) {
  const session = {
    id: 'parent',
    cwd: '/repo',
    projectPath: '/repo',
    snapshot: { messages, providerId: 'claude-base' },
    getUiSettings: () => ({ permissionMode: 'bypassPermissions', selectedModel: 'opus', selectedEffort: 'high', apiProviderId: null }),
    emitHostEvent: vi.fn((event: AgentEvent) => {
      if (event.type === 'suggested_task_updated') {
        session.snapshot = { ...session.snapshot, messages: applySuggestedTaskUpdate(session.snapshot.messages, event.taskId, event.state) }
      }
    }),
  }
  return session
}

function fakeHost(parent: ReturnType<typeof fakeSession>) {
  const child = { setTitle: vi.fn() }
  return {
    child,
    host: { getSession: (id: string) => (id === 'parent' ? parent : id === 'child' ? child : null) } as never,
  }
}

function started(sessionId = 'child') {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ status: 'started', mode: 'handoff', sessionId }) }] }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.grantForLaunch.mockReturnValue(null)
  mocks.resolveMainWorktreeDir.mockResolvedValue('/repo')
  mocks.startSessionAgent.mockResolvedValue(started())
})

describe('launchSuggestedTask', () => {
  it('approves a handoff in a fresh branch worktree and starts it with the brief', async () => {
    const parent = fakeSession()
    const { host, child } = fakeHost(parent)

    await expect(launchSuggestedTask(host, 'parent', TASK_ID)).resolves.toBe('child')

    expect(mocks.createGrants).toHaveBeenCalledWith('parent', [expect.objectContaining({
      launchId: `suggested-task-${TASK_ID}`,
      mode: 'handoff',
      agentId: 'claude-base',
      summary: INPUT.tldr,
      config: expect.objectContaining({
        sandboxMode: 'off',
        permissionMode: 'bypassPermissions',
        model: 'opus',
        effort: 'high',
        cwd: '/repo',
        worktree: { enabled: true, baseBranch: 'HEAD', mode: 'branch', branchName: 'task/fix-the-flaky-login-test-0b9f3c1e' },
      }),
    })])
    expect(mocks.startSessionAgent).toHaveBeenCalledWith('parent', { launchId: `suggested-task-${TASK_ID}`, task: INPUT.prompt }, host)
    expect(child.setTitle).toHaveBeenCalledWith(INPUT.title, 'agent')
    expect(parent.emitHostEvent).toHaveBeenCalledWith({
      type: 'suggested_task_updated',
      taskId: TASK_ID,
      state: { status: 'launched', sessionId: 'child' },
    })
  })

  it('shares the checkout of a folder that is not a git repo, and honours a different project root', async () => {
    mocks.resolveMainWorktreeDir.mockRejectedValue(new Error('not a git repository'))
    const parent = fakeSession(transcript({ ...INPUT, cwd: '/other' }))
    await launchSuggestedTask(fakeHost(parent).host, 'parent', TASK_ID)
    const config = mocks.createGrants.mock.calls[0][1][0].config
    expect(config.cwd).toBe('/other')
    expect(config).not.toHaveProperty('worktree')
  })

  it('reuses the grant of an earlier failed start instead of approving twice', async () => {
    mocks.grantForLaunch.mockReturnValue({ grant_id: 'g1' })
    await launchSuggestedTask(fakeHost(fakeSession()).host, 'parent', TASK_ID)
    expect(mocks.createGrants).not.toHaveBeenCalled()
    expect(mocks.startSessionAgent).toHaveBeenCalledTimes(1)
  })

  it('runs one launch for concurrent clicks and refuses a card that already launched', async () => {
    const parent = fakeSession()
    const { host } = fakeHost(parent)
    const [first, second] = await Promise.all([
      launchSuggestedTask(host, 'parent', TASK_ID),
      launchSuggestedTask(host, 'parent', TASK_ID),
    ])
    expect([first, second]).toEqual(['child', 'child'])
    expect(mocks.startSessionAgent).toHaveBeenCalledTimes(1)
    await expect(launchSuggestedTask(host, 'parent', TASK_ID)).rejects.toThrow(/already launched/)
  })

  it('keeps the card pending when the start fails', async () => {
    mocks.startSessionAgent.mockResolvedValue({
      content: [{ type: 'text', text: JSON.stringify({ status: 'error', message: 'Working directory does not exist' }) }],
      isError: true,
    })
    const parent = fakeSession()
    await expect(launchSuggestedTask(fakeHost(parent).host, 'parent', TASK_ID)).rejects.toThrow('Working directory does not exist')
    expect(parent.emitHostEvent).not.toHaveBeenCalled()
  })

  it('refuses an unknown card', async () => {
    await expect(launchSuggestedTask(fakeHost(fakeSession()).host, 'parent', 'missing')).rejects.toBeInstanceOf(SuggestedTaskError)
    expect(mocks.createGrants).not.toHaveBeenCalled()
  })
})

describe('dismissSuggestedTask', () => {
  it('records who dismissed a pending card, then refuses to dismiss it again', () => {
    const session = fakeSession()
    dismissSuggestedTask(session, TASK_ID, 'agent', '  Fixed it myself ')
    expect(session.emitHostEvent).toHaveBeenCalledWith({
      type: 'suggested_task_updated',
      taskId: TASK_ID,
      state: { status: 'dismissed', by: 'agent', reason: 'Fixed it myself' },
    })
    expect(() => dismissSuggestedTask(session, TASK_ID, 'user')).toThrow(/already dismissed/)
  })
})

describe('suggestedTaskReply', () => {
  it('turns an expected refusal into a message and lets other failures through', async () => {
    await expect(suggestedTaskReply(async () => ({ sessionId: 's' }))).resolves.toEqual({ ok: true, sessionId: 's' })
    await expect(suggestedTaskReply(async () => { throw new SuggestedTaskError('nope') })).resolves.toEqual({ ok: false, error: 'nope' })
    await expect(suggestedTaskReply(async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })
})

describe('suggestedTaskBranchName', () => {
  it('falls back to the id for a title with no Latin letters', () => {
    expect(suggestedTaskBranchName('修复登录测试', TASK_ID)).toBe('task/0b9f3c1e')
  })
})

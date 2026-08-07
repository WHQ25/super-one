import type { AskUserQuestionRequest, ChatMessage, PermissionRequest, PlanApprovalRequest } from '@superone/shared/agent-types'
import {
  getPendingReason,
  isLiveSession,
  getSessionTitle,
  resolveSessionTitle,
  DEFAULT_SESSION_TITLE,
  type PendingReasonT,
} from './session-state-utils'

/** English templates mirroring sidebar.pending — keeps pure-unit tests free of i18n init. */
const EN: Record<string, string> = {
  'sidebar.pending.allowTool': 'Allow {{tool}}?',
  'sidebar.pending.allowApp': 'Allow {{app}}?',
  'sidebar.pending.allowComputerUse': 'Allow computer use?',
  'sidebar.pending.approveVideoGen': 'Approve video generation?',
  'sidebar.pending.confirmNamed': 'Confirm {{name}}?',
  'sidebar.pending.confirmSettings': 'Confirm {{count}} settings?',
  'sidebar.pending.confirmConfig': 'Confirm config change?',
  'sidebar.pending.waitingInput': 'Waiting for input',
  'sidebar.pending.reviewPlan': 'Review plan',
  'sidebar.pending.collabFallback': 'Approve agent launch?',
  'sidebar.pending.collabOne': 'Launch {{name}}?',
  'sidebar.pending.collabOneWithRole': 'Launch {{name}} · {{role}}?',
  'sidebar.pending.collabTwo': 'Launch {{a}} + {{b}}?',
  'sidebar.pending.collabMany': 'Launch {{count}} agents?',
  'sidebar.pending.agentLaunch': 'agent launch',
  'sidebar.pending.toolFallback': 'tool',
}

const ZH: Record<string, string> = {
  'sidebar.pending.allowTool': '允许 {{tool}}？',
  'sidebar.pending.allowApp': '允许 {{app}}？',
  'sidebar.pending.allowComputerUse': '允许 Computer Use？',
  'sidebar.pending.approveVideoGen': '批准视频生成？',
  'sidebar.pending.confirmNamed': '确认 {{name}}？',
  'sidebar.pending.confirmSettings': '确认 {{count}} 项设置？',
  'sidebar.pending.confirmConfig': '确认配置更改？',
  'sidebar.pending.waitingInput': '等待输入',
  'sidebar.pending.reviewPlan': '审核计划',
  'sidebar.pending.collabFallback': '批准启动 Agent？',
  'sidebar.pending.collabOne': '启动 {{name}}？',
  'sidebar.pending.collabOneWithRole': '启动 {{name}} · {{role}}？',
  'sidebar.pending.collabTwo': '启动 {{a}} + {{b}}？',
  'sidebar.pending.collabMany': '启动 {{count}} 个 Agent？',
  'sidebar.pending.agentLaunch': 'Agent 启动',
  'sidebar.pending.toolFallback': '工具',
}

function makeT(table: Record<string, string>): PendingReasonT {
  return (key, options) => {
    let out = table[key] ?? key
    if (options) {
      for (const [k, v] of Object.entries(options)) {
        out = out.replaceAll(`{{${k}}}`, String(v))
      }
    }
    return out
  }
}

const tEn = makeT(EN)
const tZh = makeT(ZH)

describe('getPendingReason', () => {
  it('should return permission reason when permissions are pending', () => {
    const perms: PermissionRequest[] = [
      { requestId: '1', toolName: 'Write', input: {}, allowAlwaysAllow: true },
    ]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Allow Write?')
  })

  it('should return first permission toolName when multiple are pending', () => {
    const perms: PermissionRequest[] = [
      { requestId: '1', toolName: 'Write', input: {}, allowAlwaysAllow: true },
      { requestId: '2', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
    ]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Allow Write?')
  })

  it('should return question reason when ask_user_question is pending', () => {
    const question: AskUserQuestionRequest = {
      requestId: '1',
      questions: [{ question: 'Which file?', header: '', options: [], multiSelect: false }],
    }
    expect(getPendingReason(undefined, question, null, tEn)).toBe('Which file?')
  })

  it('should return fallback when question has no text', () => {
    const question: AskUserQuestionRequest = {
      requestId: '1',
      questions: [{ header: '', options: [], multiSelect: false } as any],
    }
    expect(getPendingReason(undefined, question, null, tEn)).toBe('Waiting for input')
  })

  it('should return plan approval reason when plan_approval is pending', () => {
    const plan: PlanApprovalRequest = {
      requestId: '1',
      planContent: 'do stuff',
      planFilePath: '/tmp/plan.md',
      allowedPrompts: [],
    }
    expect(getPendingReason(undefined, null, plan, tEn)).toBe('Review plan')
  })

  it('should prioritize permissions over question and plan', () => {
    const perms: PermissionRequest[] = [
      { requestId: '1', toolName: 'Read', input: {}, allowAlwaysAllow: true },
    ]
    const question: AskUserQuestionRequest = {
      requestId: '2',
      questions: [{ question: 'What?', header: '', options: [], multiSelect: false }],
    }
    const plan: PlanApprovalRequest = {
      requestId: '3',
      planContent: 'plan',
      planFilePath: '/tmp/plan.md',
      allowedPrompts: [],
    }
    expect(getPendingReason(perms, question, plan, tEn)).toBe('Allow Read?')
  })

  it('should return null when nothing is pending', () => {
    expect(getPendingReason(undefined, null, null, tEn)).toBeNull()
  })

  it('should return null for empty permissions array', () => {
    expect(getPendingReason([], null, null, tEn)).toBeNull()
  })

  it('summarizes session_agents_confirm with a single named agent and role', () => {
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'session_collab_request',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      sessionAgentsConfirm: {
        profiles: [],
        launches: [{
          launchId: 'l1',
          agentId: 'claude-base',
          task: 'review',
          name: 'DiffBot',
          role: 'Reviewer',
          config: { cwd: '/tmp' },
        }],
      },
    }]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Launch DiffBot · Reviewer?')
  })

  it('summarizes two collab launches with names', () => {
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'session_collab_request',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      sessionAgentsConfirm: {
        profiles: [],
        launches: [
          {
            launchId: 'l1',
            agentId: 'claude-base',
            task: 'a',
            name: 'DiffBot',
            role: 'Reviewer',
            config: { cwd: '/tmp' },
          },
          {
            launchId: 'l2',
            agentId: 'codex-base',
            task: 'b',
            name: 'TypeBot',
            role: 'Analyst',
            config: { cwd: '/tmp' },
          },
        ],
      },
    }]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Launch DiffBot + TypeBot?')
  })

  it('summarizes three or more collab launches by count', () => {
    const launches = [1, 2, 3].map((n) => ({
      launchId: `l${n}`,
      agentId: 'claude-base',
      task: 't',
      name: `Agent${n}`,
      role: 'Worker',
      config: { cwd: '/tmp' },
    }))
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'session_collab_request',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      sessionAgentsConfirm: { profiles: [], launches },
    }]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Launch 3 agents?')
  })

  it('localizes collab chips to Chinese', () => {
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'session_collab_request',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'session_agents_confirm',
      sessionAgentsConfirm: {
        profiles: [],
        launches: [{
          launchId: 'l1',
          agentId: 'claude-base',
          task: 'review',
          name: 'DiffBot',
          role: 'Reviewer',
          config: { cwd: '/tmp' },
        }],
      },
    }]
    expect(getPendingReason(perms, null, null, tZh)).toBe('启动 DiffBot · Reviewer？')
    expect(getPendingReason(
      [{
        requestId: '2',
        toolName: 'Write',
        input: {},
        allowAlwaysAllow: true,
      }],
      null,
      null,
      tZh,
    )).toBe('允许 Write？')
    expect(getPendingReason(undefined, null, {
      requestId: '3',
      planContent: 'x',
      planFilePath: '/tmp/p.md',
      allowedPrompts: [],
    }, tZh)).toBe('审核计划')
  })

  it('humanizes computer use grant with app name', () => {
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'computer_snapshot',
      input: {},
      allowAlwaysAllow: false,
      requestKind: 'computer_use_grant',
      computerUseGrant: { app: 'Safari', bundleId: 'com.apple.Safari', toolName: 'computer_snapshot' },
    }]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Allow Safari?')
    expect(getPendingReason(perms, null, null, tZh)).toBe('允许 Safari？')
  })

  it('humanizes raw MCP tool ids for generic permissions', () => {
    const perms: PermissionRequest[] = [{
      requestId: '1',
      toolName: 'mcp__superone__session_rename',
      input: {},
      allowAlwaysAllow: true,
    }]
    expect(getPendingReason(perms, null, null, tEn)).toBe('Allow session rename?')
    expect(getPendingReason(perms, null, null, tZh)).toBe('允许 session rename？')
  })
})

describe('isLiveSession', () => {
  it('should return true when isUnseen is true', () => {
    expect(isLiveSession(undefined, true)).toBe(true)
  })

  it('should return true when status is streaming', () => {
    expect(isLiveSession({ status: 'streaming' }, false)).toBe(true)
  })

  it('should return true when permissions are pending', () => {
    const session = {
      pendingPermissions: [
        { requestId: '1', toolName: 'Write', input: {}, allowAlwaysAllow: true },
      ] as PermissionRequest[],
    }
    expect(isLiveSession(session, false)).toBe(true)
  })

  it('should return true when pendingQuestion is set', () => {
    const session = {
      pendingQuestion: {
        requestId: '1',
        questions: [{ question: 'Q?', header: '', options: [], multiSelect: false }],
      } as AskUserQuestionRequest,
    }
    expect(isLiveSession(session, false)).toBe(true)
  })

  it('should return true when pendingPlanApproval is set', () => {
    const session = {
      pendingPlanApproval: {
        requestId: '1',
        planContent: 'plan',
        planFilePath: '/tmp/plan.md',
        allowedPrompts: [],
      } as PlanApprovalRequest,
    }
    expect(isLiveSession(session, false)).toBe(true)
  })

  it('should return true when awaitingAssistantReply', () => {
    expect(isLiveSession({ awaitingAssistantReply: true }, false)).toBe(true)
  })

  it('should return false when idle with no pending interactions', () => {
    expect(isLiveSession({ status: 'idle' }, false)).toBe(false)
  })

  it('should return false when session is undefined and not unseen', () => {
    expect(isLiveSession(undefined, false)).toBe(false)
  })

  it('should return false when isUnseen is undefined and session idle', () => {
    expect(isLiveSession({ status: 'idle' }, undefined)).toBe(false)
  })

  it('should return false for empty pendingPermissions', () => {
    expect(isLiveSession({ pendingPermissions: [] }, false)).toBe(false)
  })
})

describe('getSessionTitle', () => {
  it('returns first user text', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'assistant', status: 'complete', content: [{ type: 'text', text: 'hi' }], createdAt: 0 },
      { id: '2', role: 'user', status: 'complete', content: [{ type: 'text', text: '  Hello world  ' }], createdAt: 1 },
    ]
    expect(getSessionTitle(messages)).toBe('Hello world')
  })

  it('returns null for empty messages', () => {
    expect(getSessionTitle([])).toBeNull()
    expect(getSessionTitle(undefined)).toBeNull()
  })
})

describe('resolveSessionTitle', () => {
  it('prefers agent title then message then db then terminal', () => {
    expect(resolveSessionTitle('Agent', undefined, 'DB', 'term')).toBe('Agent')
    expect(resolveSessionTitle(null, [
      { id: '1', role: 'user', status: 'complete', content: [{ type: 'text', text: 'From msg' }], createdAt: 0 },
    ], 'DB', 'term')).toBe('From msg')
    expect(resolveSessionTitle(null, undefined, 'DB', 'term')).toBe('DB')
    expect(resolveSessionTitle(null, undefined, null, 'term')).toBe('term')
    expect(resolveSessionTitle(null, undefined, null)).toBe(DEFAULT_SESSION_TITLE)
  })
})

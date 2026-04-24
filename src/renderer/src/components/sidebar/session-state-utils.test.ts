import type { AskUserQuestionRequest, ChatMessage, PermissionRequest, PlanApprovalRequest } from '../../../../shared/agent-types'
import { getPendingReason, isLiveSession, getSessionTitle } from './session-state-utils'

describe('getPendingReason', () => {
  it('should return permission reason when permissions are pending', () => {
    const perms: PermissionRequest[] = [
      { requestId: '1', toolName: 'Write', input: {}, allowAlwaysAllow: true },
    ]
    expect(getPendingReason(perms, null, null)).toBe('Allow Write?')
  })

  it('should return first permission toolName when multiple are pending', () => {
    const perms: PermissionRequest[] = [
      { requestId: '1', toolName: 'Write', input: {}, allowAlwaysAllow: true },
      { requestId: '2', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
    ]
    expect(getPendingReason(perms, null, null)).toBe('Allow Write?')
  })

  it('should return question reason when ask_user_question is pending', () => {
    const question: AskUserQuestionRequest = {
      requestId: '1',
      questions: [{ question: 'Which file?', header: '', options: [], multiSelect: false }],
    }
    expect(getPendingReason(undefined, question, null)).toBe('Which file?')
  })

  it('should return fallback when question has no text', () => {
    const question: AskUserQuestionRequest = {
      requestId: '1',
      questions: [{ header: '', options: [], multiSelect: false } as any],
    }
    expect(getPendingReason(undefined, question, null)).toBe('Waiting for input')
  })

  it('should return plan approval reason when plan_approval is pending', () => {
    const plan: PlanApprovalRequest = {
      requestId: '1',
      planContent: 'do stuff',
      planFilePath: '/tmp/plan.md',
      allowedPrompts: [],
    }
    expect(getPendingReason(undefined, null, plan)).toBe('Review plan')
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
    expect(getPendingReason(perms, question, plan)).toBe('Allow Read?')
  })

  it('should return null when nothing is pending', () => {
    expect(getPendingReason(undefined, null, null)).toBeNull()
  })

  it('should return null for empty permissions array', () => {
    expect(getPendingReason([], null, null)).toBeNull()
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

  it('should return true when question is pending', () => {
    const session = {
      pendingQuestion: {
        requestId: '1',
        questions: [{ question: 'Q?', header: '', options: [], multiSelect: false }],
      } as AskUserQuestionRequest,
    }
    expect(isLiveSession(session, false)).toBe(true)
  })

  it('should return true when plan approval is pending', () => {
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

  it('should return true when awaitingAssistantReply is true', () => {
    expect(isLiveSession({ awaitingAssistantReply: true }, false)).toBe(true)
  })

  it('should return false for idle session with no pending items', () => {
    expect(isLiveSession({ status: 'idle' }, false)).toBe(false)
  })

  it('should return false when session is undefined and isUnseen is false', () => {
    expect(isLiveSession(undefined, false)).toBe(false)
  })

  it('should return false when isUnseen is undefined and session is idle', () => {
    expect(isLiveSession({ status: 'idle' }, undefined)).toBe(false)
  })

  it('should return false for empty permissions array', () => {
    expect(isLiveSession({ pendingPermissions: [] }, false)).toBe(false)
  })
})

describe('getSessionTitle', () => {
  const makeMessage = (role: 'user' | 'assistant', text: string): ChatMessage => ({
    id: '1',
    role,
    status: 'complete',
    content: [{ type: 'text', text }],
    createdAt: new Date().toISOString(),
    providerId: 'claude',
  })

  it('should return null for undefined messages', () => {
    expect(getSessionTitle(undefined)).toBeNull()
  })

  it('should return null for empty messages array', () => {
    expect(getSessionTitle([])).toBeNull()
  })

  it('should return null when no user messages exist', () => {
    expect(getSessionTitle([makeMessage('assistant', 'Hello')])).toBeNull()
  })

  it('should extract text from first user message', () => {
    expect(getSessionTitle([makeMessage('user', 'Fix the bug')])).toBe('Fix the bug')
  })

  it('should use the first user message, not later ones', () => {
    const messages = [
      makeMessage('assistant', 'Hi'),
      makeMessage('user', 'First question'),
      makeMessage('assistant', 'Answer'),
      makeMessage('user', 'Second question'),
    ]
    expect(getSessionTitle(messages)).toBe('First question')
  })

  it('should truncate text longer than 100 characters', () => {
    const longText = 'a'.repeat(150)
    expect(getSessionTitle([makeMessage('user', longText)])).toBe('a'.repeat(100))
  })

  it('should skip user messages with only non-text content', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        status: 'complete',
        content: [{ type: 'image', name: 'screenshot.png' }],
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      },
      makeMessage('user', 'Describe this image'),
    ]
    expect(getSessionTitle(messages)).toBe('Describe this image')
  })

  it('should skip user messages with empty text', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        status: 'complete',
        content: [{ type: 'text', text: '   ' }],
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      },
      makeMessage('user', 'Actual question'),
    ]
    expect(getSessionTitle(messages)).toBe('Actual question')
  })

  it('should join multiple text blocks in a single message', () => {
    const messages: ChatMessage[] = [
      {
        id: '1',
        role: 'user',
        status: 'complete',
        content: [
          { type: 'text', text: 'Hello' },
          { type: 'text', text: 'World' },
        ],
        createdAt: new Date().toISOString(),
        providerId: 'claude',
      },
    ]
    expect(getSessionTitle(messages)).toBe('Hello World')
  })
})

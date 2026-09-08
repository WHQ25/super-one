import { describe, expect, it } from 'vitest'
import {
  buildAskUserQuestionRequest,
  buildConsentRecordParams,
  buildMcpElicitPermissionRequest,
  buildPlanApprovalRequest,
  consentGateToAskUserQuestion,
  formatGrokAskUserResponse,
  formatGrokExitPlanModeResponse,
  formatGrokMcpElicitResponse,
  formatGrokScheduledTaskPrompt,
  normalizeGrokQuestions,
  parseGrokConsentGate,
  parseGrokExitPlanModeParams,
  parseGrokMcpElicitComplete,
  parseGrokMcpElicitParams,
  parseGrokScheduledTaskInject,
} from './acp-xai-extensions'

describe('normalizeGrokQuestions', () => {
  it('maps Grok question shape to SuperOne UserQuestion', () => {
    const qs = normalizeGrokQuestions([
      {
        question: 'Which one?',
        options: [
          { label: 'Alpha', description: 'first choice' },
          { label: 'Beta', description: 'second', preview: '```ts\n1\n```' },
        ],
        multiSelect: null,
      },
    ])
    expect(qs).toHaveLength(1)
    expect(qs[0]).toMatchObject({
      question: 'Which one?',
      multiSelect: false,
      options: [
        { label: 'Alpha', description: 'first choice' },
        { label: 'Beta', description: 'second', preview: '```ts\n1\n```' },
      ],
    })
    expect(qs[0].header).toBeTruthy()
  })

  it('honors multi_select / multiSelect true', () => {
    expect(normalizeGrokQuestions([{ question: 'Q?', options: [{ label: 'A' }], multi_select: true }])[0].multiSelect).toBe(true)
    expect(normalizeGrokQuestions([{ question: 'Q?', options: [{ label: 'A' }], multiSelect: true }])[0].multiSelect).toBe(true)
  })

  it('skips empty or invalid entries', () => {
    expect(normalizeGrokQuestions([null, {}, { question: '' }, 'x'])).toEqual([])
  })
})

describe('formatGrokAskUserResponse', () => {
  it('formats accepted answers with outcome tag (Grok wire)', () => {
    expect(formatGrokAskUserResponse({
      kind: 'accepted',
      answers: { 'Which one?': 'Alpha' },
      annotations: { 'Which one?': { notes: 'n1' } },
    })).toEqual({
      outcome: 'accepted',
      answers: { 'Which one?': ['Alpha'] },
      annotations: { 'Which one?': { notes: 'n1' } },
    })
  })

  it('splits multi-select comma-joined answers and omits empty annotations', () => {
    const res = formatGrokAskUserResponse({
      kind: 'accepted',
      answers: { 'Pick many': 'A, B' },
    })
    expect(res).toEqual({
      outcome: 'accepted',
      answers: { 'Pick many': ['A', 'B'] },
    })
    expect(res).not.toHaveProperty('annotations')
  })

  it('formats cancelled as outcome=cancelled', () => {
    expect(formatGrokAskUserResponse({ kind: 'cancelled' })).toEqual({ outcome: 'cancelled' })
  })
})

describe('buildAskUserQuestionRequest', () => {
  it('builds request with stable requestId', () => {
    const req = buildAskUserQuestionRequest({
      questions: [{ question: 'Go?', options: [{ label: 'Yes', description: '' }] }],
    }, 'req-1')
    expect(req.requestId).toBe('req-1')
    expect(req.questions[0].question).toBe('Go?')
  })
})

describe('parseGrokExitPlanModeParams', () => {
  it('reads camelCase wire fields', () => {
    expect(parseGrokExitPlanModeParams({
      sessionId: 's1',
      toolCallId: 'tc1',
      planContent: '# Plan',
    })).toMatchObject({
      sessionId: 's1',
      toolCallId: 'tc1',
      planContent: '# Plan',
    })
  })

  it('tolerates snake_case', () => {
    expect(parseGrokExitPlanModeParams({
      session_id: 's2',
      tool_call_id: 'tc2',
      plan_content: 'body',
    })).toMatchObject({
      sessionId: 's2',
      toolCallId: 'tc2',
      planContent: 'body',
    })
  })

  it('handles empty plan and invalid input', () => {
    expect(parseGrokExitPlanModeParams({ toolCallId: 't', planContent: null }).planContent).toBeNull()
    expect(parseGrokExitPlanModeParams(null)).toEqual({})
    expect(parseGrokExitPlanModeParams('x')).toEqual({})
  })
})

describe('parseGrokConsentGate', () => {
  it('reads nested consent_gate with camelCase or snake_case accept label', () => {
    expect(parseGrokConsentGate({
      consent_gate: {
        id: 'enterprise-tos-2026-08',
        version: 2,
        title: 'Terms',
        body: 'Please accept.',
        accept_label: 'I agree',
      },
    })).toEqual({
      id: 'enterprise-tos-2026-08',
      version: 2,
      title: 'Terms',
      body: 'Please accept.',
      acceptLabel: 'I agree',
    })
    expect(parseGrokConsentGate({
      consentGate: { id: 'n', acceptLabel: 'OK' },
    })).toEqual({ id: 'n', version: 1, acceptLabel: 'OK' })
  })

  it('returns null without an id', () => {
    expect(parseGrokConsentGate({ consent_gate: { version: 1 } })).toBeNull()
    expect(parseGrokConsentGate({})).toBeNull()
    expect(parseGrokConsentGate(null)).toBeNull()
  })

  it('does not treat a settings snapshot as a consent gate', () => {
    expect(parseGrokConsentGate({
      id: 'settings-rev',
      sharing_enabled: true,
      permission_mode: 'ask',
    })).toBeNull()
  })
})

describe('consentGateToAskUserQuestion', () => {
  it('maps a gate onto the existing ask-user-question prompt', () => {
    const req = consentGateToAskUserQuestion({
      id: 'tos',
      version: 1,
      title: 'Terms of use',
      body: 'Read this.',
      acceptLabel: 'Accept',
    }, 'acp_consent_tos_1')
    expect(req.requestId).toBe('acp_consent_tos_1')
    expect(req.questions[0]).toMatchObject({
      header: 'Terms of use',
      question: 'Terms of use\n\nRead this.',
      options: [{ label: 'Accept', description: '' }],
      multiSelect: false,
    })
    expect(buildConsentRecordParams({ id: 'tos', version: 3 })).toEqual({
      noticeId: 'tos',
      version: 3,
    })
  })
})

describe('parseGrokMcpElicitParams', () => {
  it('parses form-mode camelCase wire', () => {
    const parsed = parseGrokMcpElicitParams({
      sessionId: 's1',
      toolCallId: 'elicit-1',
      serverName: 'github',
      message: 'Need email',
      mode: 'form',
      requestedSchema: {
        type: 'object',
        properties: { email: { type: 'string', title: 'Email' } },
        required: ['email'],
      },
    })
    expect(parsed).toMatchObject({
      sessionId: 's1',
      toolCallId: 'elicit-1',
      serverName: 'github',
      message: 'Need email',
      mode: 'form',
    })
    expect(parsed?.requestedSchema).toMatchObject({ type: 'object' })
  })

  it('parses url-mode snake_case and infers mode from url', () => {
    expect(parseGrokMcpElicitParams({
      session_id: 's2',
      tool_call_id: 'elicit-2',
      server_name: 'linear',
      message: 'Authorize Linear',
      url: 'https://linear.app/oauth',
      elicitation_id: 'e-42',
    })).toMatchObject({
      sessionId: 's2',
      toolCallId: 'elicit-2',
      serverName: 'linear',
      mode: 'url',
      url: 'https://linear.app/oauth',
      elicitationId: 'e-42',
    })
  })

  it('returns null without server or message', () => {
    expect(parseGrokMcpElicitParams(null)).toBeNull()
    expect(parseGrokMcpElicitParams({})).toBeNull()
  })
})

describe('formatGrokMcpElicitResponse', () => {
  it('formats accept with optional content', () => {
    expect(formatGrokMcpElicitResponse({ kind: 'accept', content: { email: 'a@b.c' } })).toEqual({
      outcome: 'accept',
      content: { email: 'a@b.c' },
    })
    expect(formatGrokMcpElicitResponse({ kind: 'accept' })).toEqual({ outcome: 'accept' })
  })

  it('formats decline and cancel', () => {
    expect(formatGrokMcpElicitResponse({ kind: 'decline' })).toEqual({ outcome: 'decline' })
    expect(formatGrokMcpElicitResponse({ kind: 'cancel' })).toEqual({ outcome: 'cancel' })
  })
})

describe('buildMcpElicitPermissionRequest', () => {
  it('maps form schema onto PermissionRequest elicitation fields', () => {
    const req = buildMcpElicitPermissionRequest({
      serverName: 'github',
      message: 'Need email',
      mode: 'form',
      toolCallId: 'elicit-1',
      requestedSchema: {
        type: 'object',
        properties: { email: { type: 'string', title: 'Email' } },
        required: ['email'],
      },
    }, 'elicit-1')
    expect(req).toMatchObject({
      requestId: 'elicit-1',
      requestKind: 'mcp_elicitation',
      serverName: 'github',
      message: 'Need email',
      allowAlwaysAllow: false,
    })
    expect(req.elicitationForm).toEqual([
      { name: 'email', type: 'string', label: 'Email', required: true },
    ])
  })

  it('maps url mode as a consent card with the url as subtitle', () => {
    const req = buildMcpElicitPermissionRequest({
      serverName: 'linear',
      message: 'Authorize Linear',
      mode: 'url',
      url: 'https://linear.app/oauth',
      elicitationId: 'e-42',
    }, 'elicit-url')
    expect(req.subtitle).toBe('https://linear.app/oauth')
    expect(req.elicitationForm).toBeUndefined()
  })
})

describe('parseGrokMcpElicitComplete', () => {
  it('requires elicitationId', () => {
    expect(parseGrokMcpElicitComplete({
      sessionId: 's',
      elicitationId: 'e-1',
      serverName: 'github',
    })).toEqual({ sessionId: 's', elicitationId: 'e-1', serverName: 'github' })
    expect(parseGrokMcpElicitComplete({ sessionId: 's' })).toBeNull()
  })
})

describe('parseGrokScheduledTaskInject', () => {
  it('parses camelCase and snake_case', () => {
    expect(parseGrokScheduledTaskInject({
      sessionId: 's1',
      taskId: 'task-42',
      prompt: '/pr-babysit check',
      humanSchedule: 'every 5m',
    })).toEqual({
      sessionId: 's1',
      taskId: 'task-42',
      prompt: '/pr-babysit check',
      humanSchedule: 'every 5m',
    })
    expect(parseGrokScheduledTaskInject({
      task_id: 't2',
      prompt: 'echo hi',
      human_schedule: 'every 1m',
    })).toEqual({
      taskId: 't2',
      prompt: 'echo hi',
      humanSchedule: 'every 1m',
    })
  })

  it('returns null without a prompt', () => {
    expect(parseGrokScheduledTaskInject({ taskId: 't' })).toBeNull()
    expect(parseGrokScheduledTaskInject(null)).toBeNull()
  })
})

describe('formatGrokScheduledTaskPrompt', () => {
  it('wraps the user prompt in system-reminder framing', () => {
    const out = formatGrokScheduledTaskPrompt('do stuff', 'task-1', 'every 5m')
    expect(out.startsWith('<system-reminder>')).toBe(true)
    expect(out).toContain('task task-1')
    expect(out).toContain('every 5m')
    expect(out.endsWith('do stuff')).toBe(true)
    expect(out).not.toContain('<user_query>')
  })
})

describe('buildPlanApprovalRequest', () => {
  it('maps plan content and empty path/prompts', () => {
    expect(buildPlanApprovalRequest({
      toolCallId: 'tc',
      planContent: '## Steps\n1. A',
    }, 'tc')).toEqual({
      requestId: 'tc',
      planContent: '## Steps\n1. A',
      planFilePath: '',
      allowedPrompts: [],
    })
  })

  it('uses empty string when planContent missing', () => {
    expect(buildPlanApprovalRequest({}, 'id').planContent).toBe('')
  })
})

describe('formatGrokExitPlanModeResponse', () => {
  it('formats approved without feedback', () => {
    expect(formatGrokExitPlanModeResponse({ kind: 'approved' })).toEqual({ outcome: 'approved' })
  })

  it('formats cancelled with optional feedback', () => {
    expect(formatGrokExitPlanModeResponse({ kind: 'cancelled' })).toEqual({ outcome: 'cancelled' })
    expect(formatGrokExitPlanModeResponse({ kind: 'cancelled', feedback: ' add tests ' })).toEqual({
      outcome: 'cancelled',
      feedback: 'add tests',
    })
  })

  it('formats abandoned', () => {
    expect(formatGrokExitPlanModeResponse({ kind: 'abandoned' })).toEqual({ outcome: 'abandoned' })
  })
})

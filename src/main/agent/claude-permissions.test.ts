import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockReadFileSync, mockHomedir } = vi.hoisted(() => ({
  mockReadFileSync: vi.fn(),
  mockHomedir: vi.fn(() => '/mock-home'),
}))

vi.mock('fs', () => ({ readFileSync: mockReadFileSync }))
vi.mock('os', () => ({ homedir: mockHomedir }))
vi.mock('../logger', () => ({ default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../mcp/superone-mcp-server', () => ({ isToolPreapproved: vi.fn(() => false) }))

import {
  respondToPermission,
  respondToQuestion,
  dismissQuestion,
  respondToPlanApproval,
  rejectAllPending,
  createCanUseTool,
  type PendingPermission,
  type PendingQuestion,
  type PendingPlanApproval,
} from './claude-permissions'
import type { AgentEvent } from '../../shared/agent-types'

function makeSignal(aborted = false): AbortSignal {
  return { aborted } as AbortSignal
}

describe('respondToPermission', () => {
  it('should resolve pending permission with correct args', () => {
    const map = new Map<string, PendingPermission>()
    const resolve = vi.fn()
    map.set('req1', { resolve, toolUseID: 'tu1' })

    expect(respondToPermission(map, 'req1', true, true, 'reason', [0, 2])).toBe(true)

    expect(resolve).toHaveBeenCalledWith({ allow: true, alwaysAllow: true, reason: 'reason', selectedSuggestions: [0, 2] })
  })

  it('should remove from map after resolving', () => {
    const map = new Map<string, PendingPermission>()
    map.set('req1', { resolve: vi.fn(), toolUseID: 'tu1' })

    respondToPermission(map, 'req1', false)

    expect(map.has('req1')).toBe(false)
  })

  it('should no-op for unknown requestId', () => {
    const map = new Map<string, PendingPermission>()
    expect(respondToPermission(map, 'unknown', true)).toBe(false)
  })
})

describe('respondToQuestion', () => {
  it('should resolve pending question with answers and annotations', () => {
    const map = new Map<string, PendingQuestion>()
    const resolve = vi.fn()
    map.set('q1', { resolve })

    const answers = { 'What?': 'Yes' }
    const annotations = { 'What?': { preview: 'preview-data' } }
    respondToQuestion(map, 'q1', answers, annotations)

    expect(resolve).toHaveBeenCalledWith({ answers, annotations })
    expect(map.has('q1')).toBe(false)
  })
})

describe('dismissQuestion', () => {
  it('should resolve pending question with null', () => {
    const map = new Map<string, PendingQuestion>()
    const resolve = vi.fn()
    map.set('q1', { resolve })

    dismissQuestion(map, 'q1')

    expect(resolve).toHaveBeenCalledWith(null)
    expect(map.has('q1')).toBe(false)
  })
})

describe('respondToPlanApproval', () => {
  it('should resolve pending approval with approved and feedback', () => {
    const map = new Map<string, PendingPlanApproval>()
    const resolve = vi.fn()
    map.set('p1', { resolve })

    respondToPlanApproval(map, 'p1', true, 'looks good')

    expect(resolve).toHaveBeenCalledWith({ approved: true, feedback: 'looks good' })
    expect(map.has('p1')).toBe(false)
  })
})

describe('rejectAllPending', () => {
  it('should reject all permissions with allow:false', () => {
    const perms = new Map<string, PendingPermission>()
    const r1 = vi.fn(), r2 = vi.fn()
    perms.set('a', { resolve: r1, toolUseID: 'tu1' })
    perms.set('b', { resolve: r2, toolUseID: 'tu2' })

    rejectAllPending(perms)

    expect(r1).toHaveBeenCalledWith({ allow: false })
    expect(r2).toHaveBeenCalledWith({ allow: false })
    expect(perms.size).toBe(0)
  })

  it('should dismiss all questions with null', () => {
    const perms = new Map<string, PendingPermission>()
    const questions = new Map<string, PendingQuestion>()
    const resolve = vi.fn()
    questions.set('q1', { resolve })

    rejectAllPending(perms, questions)

    expect(resolve).toHaveBeenCalledWith(null)
    expect(questions.size).toBe(0)
  })

  it('should reject all plan approvals with approved:false', () => {
    const perms = new Map<string, PendingPermission>()
    const plans = new Map<string, PendingPlanApproval>()
    const resolve = vi.fn()
    plans.set('p1', { resolve })

    rejectAllPending(perms, undefined, plans)

    expect(resolve).toHaveBeenCalledWith({ approved: false })
    expect(plans.size).toBe(0)
  })

  it('should work when optional maps are undefined', () => {
    const perms = new Map<string, PendingPermission>()
    expect(() => rejectAllPending(perms, undefined, undefined)).not.toThrow()
  })
})

describe('createCanUseTool', () => {
  let perms: Map<string, PendingPermission>
  let questions: Map<string, PendingQuestion>
  let plans: Map<string, PendingPlanApproval>
  let events: AgentEvent[]
  let emit: (event: AgentEvent) => void

  beforeEach(() => {
    perms = new Map()
    questions = new Map()
    plans = new Map()
    events = []
    emit = (e) => events.push(e)
    mockReadFileSync.mockReset()
    mockHomedir.mockReturnValue('/mock-home')
  })

  function makeContext(overrides: Partial<Parameters<ReturnType<typeof createCanUseTool>['canUseTool']>[2]> = {}) {
    return {
      toolUseID: 'tu-1',
      signal: makeSignal(),
      ...overrides,
    }
  }

  it('should auto-approve mcp__widget__ tools without permission prompt', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const result = await canUseTool('mcp__widget__show_widget', { title: 'test' }, makeContext())
    expect(result.behavior).toBe('allow')
    expect(events).toHaveLength(0)
    expect(perms.size).toBe(0)
  })

  it('should auto-approve mcp__superone__read_miniapp_guide without permission prompt', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const result = await canUseTool('mcp__superone__read_miniapp_guide', { topic: 'overview' }, makeContext())
    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual({ topic: 'overview' })
    expect(events).toHaveLength(0)
    expect(perms.size).toBe(0)
  })

  it('should auto-approve preapproved miniapp tools without permission prompt', async () => {
    const { isToolPreapproved } = await import('../mcp/superone-mcp-server')
    vi.mocked(isToolPreapproved).mockReturnValueOnce(true)
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const result = await canUseTool('mcp__superone__hello__render_data', { data: [] }, makeContext())
    expect(result.behavior).toBe('allow')
    expect(events).toHaveLength(0)
    expect(perms.size).toBe(0)
  })

  it('should not auto-approve non-preapproved miniapp tools', async () => {
    const { isToolPreapproved } = await import('../mcp/superone-mcp-server')
    vi.mocked(isToolPreapproved).mockReturnValueOnce(false)
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const promise = canUseTool('mcp__superone__hello__render_data', { data: [] }, makeContext())
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('permission_request')
    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true)
    await promise
  })

  it('should not auto-approve other superone MCP tools', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const promise = canUseTool('mcp__superone__setup_mini_app_dev', { name: 'Test' }, makeContext())
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('permission_request')
    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true)
    await promise
  })

  it('should emit permission_request with correct shape', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const input = { file_path: '/tmp/test.txt' }
    const suggestions = [{ type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'echo *' }]

    const promise = canUseTool('Write', input, makeContext({ suggestions }))

    const [entry] = [...perms.entries()]
    respondToPermission(perms, entry[0], true)
    await promise

    expect(events).toHaveLength(1)
    const event = events[0] as Extract<AgentEvent, { type: 'permission_request' }>
    expect(event.type).toBe('permission_request')
    expect(event.request.toolName).toBe('Write')
    expect(event.request.input).toEqual(input)
    expect(event.request.allowAlwaysAllow).toBe(true)
    expect(event.request.suggestions).toEqual(suggestions)
  })

  it('should return allow when user allows', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('Read', { path: '/a' }, makeContext())

    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true)

    const result = await promise
    expect(result.behavior).toBe('allow')
  })

  it('should return deny with message when user denies', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('Bash', { command: 'rm -rf /' }, makeContext())

    const [id] = [...perms.keys()]
    respondToPermission(perms, id, false, undefined, 'too dangerous')

    const result = await promise
    expect(result.behavior).toBe('deny')
    expect(result.message).toBe('[denied] too dangerous')
  })

  it('should handle alwaysAllow with all suggestions as updatedPermissions', async () => {
    const suggestions = [
      { type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'echo *' },
      { type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'ls *' },
    ]
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('Bash', { command: 'echo hi' }, makeContext({ suggestions }))

    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true, true)

    const result = await promise
    expect(result.behavior).toBe('allow')
    expect(result.updatedPermissions).toEqual(suggestions)
  })

  it('should handle selectedSuggestions filtering', async () => {
    const suggestions = [
      { type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'echo *' },
      { type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'ls *' },
      { type: 'bash' as const, tool: 'Bash', on: 'command', rule: 'cat *' },
    ]
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('Bash', { command: 'echo hi' }, makeContext({ suggestions }))

    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true, false, undefined, [0, 2])

    const result = await promise
    expect(result.behavior).toBe('allow')
    expect(result.updatedPermissions).toEqual([suggestions[0], suggestions[2]])
  })

  it('invokes onPermissionModeApplied when a selected setMode suggestion changes the session mode', async () => {
    const suggestions = [
      { type: 'addRules' as const, rules: [], destination: 'session' as const },
      { type: 'setMode' as const, mode: 'acceptEdits' as const, destination: 'session' as const },
    ]
    const appliedModes: string[] = []
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit, (m) => appliedModes.push(m))

    const promise = canUseTool('Edit', { file_path: '/tmp/a.txt' }, makeContext({ suggestions }))
    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true, false, undefined, [1])

    const result = await promise
    expect(result.behavior).toBe('allow')
    expect(result.updatedPermissions).toEqual([suggestions[1]])
    expect(appliedModes).toEqual(['acceptEdits'])
  })

  it('does not invoke onPermissionModeApplied when no setMode suggestion is selected', async () => {
    const suggestions = [
      { type: 'addRules' as const, rules: [], destination: 'session' as const },
      { type: 'setMode' as const, mode: 'acceptEdits' as const, destination: 'session' as const },
    ]
    const appliedModes: string[] = []
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit, (m) => appliedModes.push(m))

    const promise = canUseTool('Edit', { file_path: '/tmp/a.txt' }, makeContext({ suggestions }))
    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true, false, undefined, [0])

    await promise
    expect(appliedModes).toEqual([])
  })

  it('invokes onPermissionModeApplied when alwaysAllow batches in a setMode suggestion', async () => {
    const suggestions = [
      { type: 'setMode' as const, mode: 'bypassPermissions' as const, destination: 'session' as const },
    ]
    const appliedModes: string[] = []
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit, (m) => appliedModes.push(m))

    const promise = canUseTool('Edit', { file_path: '/tmp/a.txt' }, makeContext({ suggestions }))
    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true, true)

    await promise
    expect(appliedModes).toEqual(['bypassPermissions'])
  })

  it('should deny immediately when signal is aborted', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const result = await canUseTool('Read', { path: '/a' }, makeContext({ signal: makeSignal(true) }))

    expect(result.behavior).toBe('deny')
    expect(perms.size).toBe(0)
  })

  it('should route AskUserQuestion to question flow', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const questionList = [{ question: 'Pick one', options: [{ label: 'A' }, { label: 'B', preview: 'preview-B' }] }]

    const promise = canUseTool('AskUserQuestion', { questions: questionList }, makeContext())

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('ask_user_question')

    const [id] = [...questions.keys()]
    respondToQuestion(questions, id, { 'Pick one': 'B' })

    const result = await promise
    expect(result.behavior).toBe('allow')
    expect(result.updatedInput).toEqual({
      questions: questionList,
      answers: { 'Pick one': 'B' },
      annotations: { 'Pick one': { preview: 'preview-B' } },
    })
  })

  it('should route ExitPlanMode to plan approval flow', async () => {
    mockReadFileSync.mockReturnValue('# Plan content')
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('ExitPlanMode', { planFilePath: '/mock-home/.claude/plans/test.md' }, makeContext())

    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('plan_approval')

    const [id] = [...plans.keys()]
    respondToPlanApproval(plans, id, true)

    const result = await promise
    expect(result.behavior).toBe('allow')
  })

  it('should deny ExitPlanMode when user rejects the plan', async () => {
    mockReadFileSync.mockReturnValue('# Plan content')
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('ExitPlanMode', { planFilePath: '/mock-home/.claude/plans/test.md' }, makeContext())

    const [id] = [...plans.keys()]
    respondToPlanApproval(plans, id, false, 'needs changes')

    const result = await promise
    expect(result.behavior).toBe('deny')
    expect(result.message).toBe('needs changes')
  })

  it('should track Write/Edit to plan files via trackPlanFile', async () => {
    mockReadFileSync.mockReturnValue('# Tracked plan')
    const { canUseTool, trackPlanFile } = createCanUseTool(perms, questions, plans, emit)

    trackPlanFile('/mock-home/.claude/plans/my-plan.md')

    const promise = canUseTool('ExitPlanMode', {}, makeContext())

    const planEvent = events[0] as Extract<AgentEvent, { type: 'plan_approval' }>
    expect(planEvent.request.planContent).toBe('# Tracked plan')
    expect(planEvent.request.planFilePath).toBe('/mock-home/.claude/plans/my-plan.md')

    const [id] = [...plans.keys()]
    respondToPlanApproval(plans, id, true)
    await promise
  })

  it('should store event data on pending permission entry', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('Read', { path: '/a' }, makeContext())

    expect(perms.size).toBe(1)
    const [entry] = [...perms.values()]
    expect(entry.event).toBeDefined()
    expect(entry.event.type).toBe('permission_request')

    const [id] = [...perms.keys()]
    respondToPermission(perms, id, true)
    await promise
  })

  it('should store event data on pending question entry', async () => {
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)
    const questionList = [{ question: 'Pick one' }]

    const promise = canUseTool('AskUserQuestion', { questions: questionList }, makeContext())

    expect(questions.size).toBe(1)
    const [entry] = [...questions.values()]
    expect(entry.event).toBeDefined()
    expect(entry.event.type).toBe('ask_user_question')

    const [id] = [...questions.keys()]
    respondToQuestion(questions, id, { 'Pick one': 'A' })
    await promise
  })

  it('should store event data on pending plan approval entry', async () => {
    mockReadFileSync.mockReturnValue('# Plan')
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const promise = canUseTool('ExitPlanMode', { planFilePath: '/mock-home/.claude/plans/test.md' }, makeContext())

    expect(plans.size).toBe(1)
    const [entry] = [...plans.values()]
    expect(entry.event).toBeDefined()
    expect(entry.event.type).toBe('plan_approval')

    const [id] = [...plans.keys()]
    respondToPlanApproval(plans, id, true)
    await promise
  })

  it('should auto-track plan files from Write tool input', async () => {
    mockReadFileSync.mockReturnValue('# Auto-tracked')
    const { canUseTool } = createCanUseTool(perms, questions, plans, emit)

    const writePromise = canUseTool(
      'Write',
      { file_path: '/mock-home/.claude/plans/auto.md' },
      makeContext()
    )
    const [writeId] = [...perms.keys()]
    respondToPermission(perms, writeId, true)
    await writePromise

    const exitPromise = canUseTool('ExitPlanMode', {}, makeContext())
    const planEvent = events.find((e) => e.type === 'plan_approval') as Extract<AgentEvent, { type: 'plan_approval' }>
    expect(planEvent.request.planFilePath).toBe('/mock-home/.claude/plans/auto.md')

    const [planId] = [...plans.keys()]
    respondToPlanApproval(plans, planId, true)
    await exitPromise
  })
})

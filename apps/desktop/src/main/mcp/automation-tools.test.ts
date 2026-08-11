import { beforeEach, describe, expect, it, vi } from 'vitest'
import { decode as toonDecode } from '@toon-format/toon'
import type { Automation, AutomationSchedule } from '@superone/shared/agent-types'
import type { BuiltInSuperoneToolDeps } from './superone-mcp-builtins'

const {
  listAutomationsForProjectMock,
  getAutomationMock,
  createAutomationMock,
  updateAutomationMock,
  deleteAutomationMock,
} = vi.hoisted(() => ({
  listAutomationsForProjectMock: vi.fn(),
  getAutomationMock: vi.fn(),
  createAutomationMock: vi.fn(),
  updateAutomationMock: vi.fn(),
  deleteAutomationMock: vi.fn(),
}))

vi.mock('../db-automations', () => ({
  listAutomationsForProject: listAutomationsForProjectMock,
  getAutomation: getAutomationMock,
  createAutomation: createAutomationMock,
  updateAutomation: updateAutomationMock,
  deleteAutomation: deleteAutomationMock,
  // Real schedule validation uses this; keep a light stub that rejects garbage cron.
  computeNextRunAt: (schedule: { type: string; cron?: string; runAt?: string }) => {
    if (schedule.type === 'one-time') return schedule.runAt
    if (!schedule.cron || schedule.cron === 'not a cron' || !schedule.cron.includes('*')) return undefined
    return '2026-05-01T09:00:00.000Z'
  },
}))

vi.mock('../logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../automation-service', () => ({
  notifyAutomationsListChanged: vi.fn(),
}))

import {
  _resetAutomationConfirmsForTests,
  automationApplyHandler,
  automationDeleteHandler,
  automationListHandler,
  formatAgentSummary,
  formatScheduleSummary,
  mergeAgentConfig,
  resolveAutomationConfirm,
} from './automation-tools'

const PROJECT = '/tmp/proj-a'
const OTHER_PROJECT = '/tmp/proj-b'

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Daily Review',
    prompt: 'Review recent commits and summarize',
    agentConfig: { type: 'claude', permissionMode: 'bypassPermissions', sandboxMode: 'off' },
    schedule: { type: 'recurring', cron: '0 9 * * *', preset: 'daily', timeOfDay: '09:00' },
    projectPath: PROJECT,
    enabled: true,
    nextRunAt: '2026-05-01T09:00:00.000Z',
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
    ...overrides,
  }
}

function makeDeps(opts?: {
  projectPath?: string | null
  emitHostEvent?: (event: unknown) => void
}): BuiltInSuperoneToolDeps {
  const projectPath = opts?.projectPath === undefined ? PROJECT : opts.projectPath
  const emitHostEvent = opts?.emitHostEvent ?? vi.fn()
  return {
    notifyDevAppReady: vi.fn(),
    sessionId: 'sess-1',
    sessionHost: {
      getSession: () =>
        projectPath === null
          ? null
          : {
              setTitle: vi.fn(),
              projectPath: projectPath ?? undefined,
              emitHostEvent,
            },
    },
    applyAppSettings: vi.fn(),
  }
}

function parseResult(result: { content: Array<{ text: string }>; isError?: boolean }) {
  const text = result.content[0]?.text ?? ''
  try {
    return { parsed: JSON.parse(text) as Record<string, unknown>, text, isError: !!result.isError }
  } catch {
    try {
      return { parsed: toonDecode(text) as Record<string, unknown>, text, isError: !!result.isError }
    } catch {
      return { parsed: null, text, isError: !!result.isError }
    }
  }
}

describe('formatScheduleSummary', () => {
  it('formats one-time and recurring presets when summary is absent', () => {
    expect(formatScheduleSummary({ type: 'one-time', runAt: '2026-05-01T09:00:00.000Z' })).toContain('once')
    expect(formatScheduleSummary({ type: 'recurring', preset: 'daily', timeOfDay: '09:00', cron: '0 9 * * *' })).toBe(
      'daily 09:00',
    )
    expect(formatScheduleSummary({ type: 'recurring', cron: '*/15 * * * *' })).toBe('cron */15 * * * *')
  })

  it('prefers agent-written natural-language summary', () => {
    expect(
      formatScheduleSummary({
        type: 'recurring',
        cron: '0 9 * * 1-5',
        preset: 'daily',
        timeOfDay: '09:00',
        summary: '每个工作日上午 9 点',
      }),
    ).toBe('每个工作日上午 9 点')
  })
})

describe('formatAgentSummary', () => {
  it('includes permission and sandbox for claude', () => {
    expect(
      formatAgentSummary({
        type: 'claude',
        permissionMode: 'bypassPermissions',
        sandboxMode: 'off',
      }),
    ).toBe('claude · bypassPermissions · sandbox off')
  })

  it('maps codex permissionPreset to unified permissionMode', () => {
    expect(
      formatAgentSummary({ type: 'codex', permissionPreset: 'full-access', reasoningEffort: 'xhigh' }),
    ).toBe('codex · bypassPermissions · xhigh')
  })

  it('summarizes acp with agent id', () => {
    expect(
      formatAgentSummary({
        type: 'acp',
        acpAgentId: 'grok-build',
        permissionMode: 'bypassPermissions',
        model: 'grok-4',
      }),
    ).toBe('acp · bypassPermissions · grok-4 · grok-build')
  })
})

describe('mergeAgentConfig acp/opencode', () => {
  it('merges sparse acp patch', () => {
    const merged = mergeAgentConfig(
      {
        type: 'acp',
        acpAgentId: 'grok-build',
        model: 'grok-4',
        permissionMode: 'default',
      },
      { type: 'acp', permissionMode: 'bypassPermissions' },
    )
    expect(merged).toEqual({
      type: 'acp',
      acpAgentId: 'grok-build',
      model: 'grok-4',
      permissionMode: 'bypassPermissions',
    })
  })

  it('switches type with defaults applied by withAgentDefaults path in apply', () => {
    const merged = mergeAgentConfig(
      { type: 'claude', permissionMode: 'default' },
      { type: 'opencode', model: 'opencode/gpt-5' },
    )
    expect(merged).toEqual({ type: 'opencode', model: 'opencode/gpt-5' })
  })
})

describe('mergeAgentConfig', () => {
  it('merges sparse claude patch without dropping existing fields', () => {
    const merged = mergeAgentConfig(
      {
        type: 'claude',
        model: 'claude-sonnet-4',
        effort: 'high',
        permissionMode: 'default',
        sandboxMode: 'on',
      },
      { type: 'claude', permissionMode: 'bypassPermissions' },
    )
    expect(merged).toEqual({
      type: 'claude',
      model: 'claude-sonnet-4',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      sandboxMode: 'on',
    })
  })

  it('replaces base on type switch', () => {
    const merged = mergeAgentConfig(
      { type: 'claude', permissionMode: 'default', sandboxMode: 'off' },
      { type: 'codex', permissionPreset: 'read-only' },
    )
    expect(merged).toEqual({ type: 'codex', permissionPreset: 'read-only' })
  })
})

describe('automationListHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('errors without a project', () => {
    const result = automationListHandler({}, makeDeps({ projectPath: null }))
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(parsed?.status).toBe('error')
  })

  it('lists automations as TOON table rows', () => {
    listAutomationsForProjectMock.mockReturnValue([
      makeAutomation(),
      makeAutomation({ id: 'auto-2', name: 'Nightly', enabled: false }),
    ])
    const result = automationListHandler({}, makeDeps())
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(false)
    expect(parsed?.count).toBe(2)
    expect(parsed?.total).toBe(2)
    const rows = parsed?.automations as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ id: 'auto-1', name: 'Daily Review', enabled: true, agent: 'claude' })
    expect(rows[0]?.promptPreview).toMatch(/Review recent/)
    expect(rows[0]?.schedule).toBe('daily 09:00')
  })

  it('filters by enabled and query', () => {
    listAutomationsForProjectMock.mockReturnValue([
      makeAutomation({ id: 'a1', name: 'Alpha', enabled: true }),
      makeAutomation({ id: 'a2', name: 'Beta', enabled: false }),
      makeAutomation({ id: 'a3', name: 'Alpha 2', enabled: true }),
    ])
    const result = automationListHandler({ enabled: true, query: 'alpha' }, makeDeps())
    const { parsed } = parseResult(result)
    const rows = parsed?.automations as Array<Record<string, unknown>>
    expect(rows.map((r) => r.id)).toEqual(['a1', 'a3'])
  })

  it('returns full detail for id in current project', () => {
    getAutomationMock.mockReturnValue(makeAutomation({ prompt: 'Full prompt body' }))
    const result = automationListHandler({ id: 'auto-1' }, makeDeps())
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(false)
    expect(parsed?.status).toBe('ok')
    const auto = parsed?.automation as Record<string, unknown>
    expect(auto.prompt).toBe('Full prompt body')
    expect(auto.agentConfig).toMatchObject({ type: 'claude' })
    expect(auto.schedule).toMatchObject({ type: 'recurring' })
  })

  it('rejects detail for other project', () => {
    getAutomationMock.mockReturnValue(makeAutomation({ projectPath: OTHER_PROJECT }))
    const result = automationListHandler({ id: 'auto-1' }, makeDeps())
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(String(parsed?.message)).toMatch(/not found in current project/)
  })
})

/** Start apply, settle the HITL confirm, return the tool result. */
async function applyWithConfirm(
  args: Parameters<typeof automationApplyHandler>[0],
  decision: 'accept' | 'decline' = 'accept',
  deps = makeDeps(),
) {
  const emitHostEvent = deps.sessionHost?.getSession(deps.sessionId)?.emitHostEvent as ReturnType<typeof vi.fn>
  const promise = automationApplyHandler(args, deps)
  await new Promise((r) => setTimeout(r, 0))
  const req = emitHostEvent.mock.calls.find(
    (c) => (c[0] as { type?: string })?.type === 'permission_request',
  )?.[0] as { request: { requestId: string } } | undefined
  expect(req, 'expected permission_request for automation_apply').toBeTruthy()
  resolveAutomationConfirm(req!.request.requestId, decision)
  return parseResult(await promise)
}

describe('automationApplyHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAutomationConfirmsForTests()
  })

  it('creates with defaults after user accept', async () => {
    const created = makeAutomation({ id: 'new-1' })
    createAutomationMock.mockReturnValue(created)
    const schedule: AutomationSchedule = {
      type: 'recurring',
      cron: '0 9 * * *',
      preset: 'daily',
      timeOfDay: '09:00',
    }
    const { parsed, isError } = await applyWithConfirm({
      action: 'create',
      name: 'Daily Review',
      prompt: 'Review recent commits',
      schedule,
    })
    expect(isError).toBe(false)
    expect(parsed?.action).toBe('create')
    expect(createAutomationMock).toHaveBeenCalledWith(
      PROJECT,
      expect.objectContaining({
        name: 'Daily Review',
        prompt: 'Review recent commits',
        agentConfig: expect.objectContaining({ type: 'claude' }),
        schedule,
      }),
    )
  })

  it('does not create when user declines confirm', async () => {
    const { parsed, isError } = await applyWithConfirm(
      {
        action: 'create',
        name: 'Daily Review',
        prompt: 'Review recent commits',
        schedule: { type: 'recurring', cron: '0 9 * * *' },
      },
      'decline',
    )
    expect(isError).toBe(false)
    expect(parsed?.status).toBe('rejected')
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it('requires schedule on create', async () => {
    const result = await automationApplyHandler(
      { action: 'create', name: 'X', prompt: 'Y' } as never,
      makeDeps(),
    )
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(String(parsed?.message)).toMatch(/schedule/)
  })

  it('rejects invalid cron on create', async () => {
    const result = await automationApplyHandler(
      {
        action: 'create',
        name: 'Broken',
        prompt: 'x',
        schedule: { type: 'recurring', cron: 'not a cron' },
      },
      makeDeps(),
    )
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(String(parsed?.message)).toMatch(/Invalid or unusable cron/i)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it('rejects unparseable runAt on create', async () => {
    const result = await automationApplyHandler(
      {
        action: 'create',
        name: 'Broken',
        prompt: 'x',
        schedule: { type: 'one-time', runAt: 'next tuesday' },
      },
      makeDeps(),
    )
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(String(parsed?.message)).toMatch(/Invalid runAt/i)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it('rejects out-of-range dayOfWeek', async () => {
    const result = await automationApplyHandler(
      {
        action: 'create',
        name: 'Weekly',
        prompt: 'x',
        schedule: { type: 'recurring', cron: '0 9 * * 1', dayOfWeek: [7] },
      },
      makeDeps(),
    )
    const { isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(createAutomationMock).not.toHaveBeenCalled()
  })

  it('updates enabled (toggle) after user accept', async () => {
    getAutomationMock.mockReturnValue(makeAutomation())
    updateAutomationMock.mockReturnValue(makeAutomation({ enabled: false }))
    const { parsed, isError } = await applyWithConfirm({
      action: 'update',
      id: 'auto-1',
      enabled: false,
    })
    expect(isError).toBe(false)
    expect(parsed?.action).toBe('update')
    expect(updateAutomationMock).toHaveBeenCalledWith('auto-1', { enabled: false })
  })

  it('rejects update without fields', async () => {
    getAutomationMock.mockReturnValue(makeAutomation())
    const result = await automationApplyHandler({ action: 'update', id: 'auto-1' }, makeDeps())
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(true)
    expect(String(parsed?.message)).toMatch(/at least one/)
  })

  it('rejects update for other project', async () => {
    getAutomationMock.mockReturnValue(makeAutomation({ projectPath: OTHER_PROJECT }))
    const result = await automationApplyHandler(
      { action: 'update', id: 'auto-1', enabled: false },
      makeDeps(),
    )
    const { isError } = parseResult(result)
    expect(isError).toBe(true)
  })

  it('passes schedule update without forcing enabled', async () => {
    getAutomationMock.mockReturnValue(makeAutomation({ enabled: false }))
    updateAutomationMock.mockReturnValue(makeAutomation({ enabled: false }))
    const schedule = { type: 'recurring' as const, cron: '0 10 * * *', preset: 'daily' as const, timeOfDay: '10:00' }
    const { isError } = await applyWithConfirm({ action: 'update', id: 'auto-1', schedule })
    expect(isError).toBe(false)
    expect(updateAutomationMock).toHaveBeenCalledWith(
      'auto-1',
      expect.objectContaining({ schedule: expect.objectContaining({ cron: '0 10 * * *' }) }),
    )
    // Must not inject enabled:true — db preserves existing.enabled when omitted
    const patch = updateAutomationMock.mock.calls[0]![1] as Record<string, unknown>
    expect(patch).not.toHaveProperty('enabled')
  })

  it('rolls back create when disable step fails', async () => {
    const created = makeAutomation({ id: 'new-1', enabled: true })
    createAutomationMock.mockReturnValue(created)
    updateAutomationMock.mockReturnValue(undefined)
    deleteAutomationMock.mockReturnValue(true)
    const { isError } = await applyWithConfirm({
      action: 'create',
      name: 'Paused',
      prompt: 'x',
      enabled: false,
      schedule: { type: 'recurring', cron: '0 9 * * *' },
    })
    expect(isError).toBe(true)
    expect(deleteAutomationMock).toHaveBeenCalledWith('new-1')
  })

  it('merges sparse agentConfig on update instead of full replace', async () => {
    getAutomationMock.mockReturnValue(
      makeAutomation({
        agentConfig: {
          type: 'claude',
          model: 'claude-sonnet-4',
          effort: 'high',
          permissionMode: 'default',
          sandboxMode: 'on',
        },
      }),
    )
    updateAutomationMock.mockReturnValue(makeAutomation())
    const emitHostEvent = vi.fn()
    const deps = makeDeps({ emitHostEvent })
    const promise = automationApplyHandler(
      {
        action: 'update',
        id: 'auto-1',
        agentConfig: { type: 'claude', permissionMode: 'bypassPermissions' },
      },
      deps,
    )
    await new Promise((r) => setTimeout(r, 0))
    const req = emitHostEvent.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === 'permission_request',
    )?.[0] as {
      request: {
        requestId: string
        automationConfirm?: {
          changes?: Array<{ field: string; from?: string; to?: string }>
          items?: Array<{ agentSummary?: string }>
        }
      }
    }
    expect(req?.request.automationConfirm?.changes?.some((c) => c.field === 'agent')).toBe(true)
    const agentChange = req!.request.automationConfirm!.changes!.find((c) => c.field === 'agent')
    expect(agentChange?.from).toMatch(/default/)
    expect(agentChange?.to).toMatch(/bypassPermissions/)
    expect(agentChange?.to).toMatch(/sandbox on/)
    resolveAutomationConfirm(req!.request.requestId, 'accept')
    await promise
    expect(updateAutomationMock).toHaveBeenCalledWith(
      'auto-1',
      expect.objectContaining({
        agentConfig: {
          type: 'claude',
          model: 'claude-sonnet-4',
          effort: 'high',
          permissionMode: 'bypassPermissions',
          sandboxMode: 'on',
        },
      }),
    )
  })

  it('create confirm surfaces default bypassPermissions', async () => {
    createAutomationMock.mockReturnValue(makeAutomation({ id: 'new-1' }))
    const emitHostEvent = vi.fn()
    const deps = makeDeps({ emitHostEvent })
    const promise = automationApplyHandler(
      {
        action: 'create',
        name: 'Daily Review',
        prompt: 'x',
        schedule: { type: 'recurring', cron: '0 9 * * *' },
      },
      deps,
    )
    await new Promise((r) => setTimeout(r, 0))
    const req = emitHostEvent.mock.calls.find(
      (c) => (c[0] as { type?: string })?.type === 'permission_request',
    )?.[0] as {
      request: {
        requestId: string
        automationConfirm?: { items?: Array<{ agentSummary?: string }> }
      }
    }
    expect(req?.request.automationConfirm?.items?.[0]?.agentSummary).toMatch(/bypassPermissions/)
    resolveAutomationConfirm(req!.request.requestId, 'accept')
    await promise
  })
})

describe('automationDeleteHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetAutomationConfirmsForTests()
  })

  it('requires ids', async () => {
    const result = await automationDeleteHandler({ ids: [] }, makeDeps())
    const { isError } = parseResult(result)
    expect(isError).toBe(true)
  })

  it('returns not_found when no ids match current project', async () => {
    getAutomationMock.mockReturnValue(undefined)
    const result = await automationDeleteHandler({ ids: ['missing'] }, makeDeps())
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(false)
    expect(parsed?.status).toBe('not_found')
    expect(parsed?.deleted).toEqual([])
    expect(parsed?.notFound).toEqual(['missing'])
  })

  it('deletes after user accept', async () => {
    getAutomationMock.mockReturnValue(makeAutomation())
    deleteAutomationMock.mockReturnValue(true)
    const emitHostEvent = vi.fn()
    const deps = makeDeps({ emitHostEvent })
    const deletePromise = automationDeleteHandler({ ids: ['auto-1'] }, deps)
    await new Promise((r) => setTimeout(r, 0))
    expect(emitHostEvent).toHaveBeenCalled()
    const req = emitHostEvent.mock.calls[0]![0] as { type: string; request: { requestId: string } }
    expect(req.type).toBe('permission_request')
    resolveAutomationConfirm(req.request.requestId, 'accept')
    const result = await deletePromise
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(false)
    expect(parsed?.status).toBe('ok')
    expect(parsed?.deleted).toEqual([{ id: 'auto-1', name: 'Daily Review' }])
    expect(deleteAutomationMock).toHaveBeenCalledWith('auto-1')
  })

  it('returns rejected when user declines', async () => {
    getAutomationMock.mockReturnValue(makeAutomation())
    const emitHostEvent = vi.fn()
    const deps = makeDeps({ emitHostEvent })
    const deletePromise = automationDeleteHandler({ ids: ['auto-1'] }, deps)
    await new Promise((r) => setTimeout(r, 0))
    const req = emitHostEvent.mock.calls[0]![0] as { type: string; request: { requestId: string } }
    resolveAutomationConfirm(req.request.requestId, 'decline')
    const result = await deletePromise
    const { parsed, isError } = parseResult(result)
    expect(isError).toBe(false)
    expect(parsed?.status).toBe('rejected')
    expect(deleteAutomationMock).not.toHaveBeenCalled()
  })
})

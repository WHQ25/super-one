import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, getProjectIdMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  getProjectIdMock: vi.fn(),
}))

vi.mock('./database', () => ({
  getDb: getDbMock,
}))

vi.mock('./recent-folders', () => ({
  getProjectId: getProjectIdMock,
}))

vi.mock('croner', () => ({
  Cron: class {
    constructor(private expr: string) {}
    nextRun() {
      return new Date('2026-05-01T09:00:00.000Z')
    }
  },
}))

import {
  computeNextRunAt,
  createAutomation,
  deleteAutomation,
  getAutomation,
  listAutomationsForProject,
  listDueAutomations,
  updateAutomation,
  updateAutomationRunStatus,
  refreshAllNextRunAt,
} from './db-automations'
import type { AutomationSchedule, CreateAutomationRequest } from '../shared/agent-types'

const PROJECT_PATH = '/tmp/test-project'
const PROJECT_ID = 'proj-1'

const makeClaudeRequest = (overrides?: Partial<CreateAutomationRequest>): CreateAutomationRequest => ({
  name: 'Daily Review',
  prompt: 'Review recent commits',
  agentConfig: { type: 'claude', permissionMode: 'bypassPermissions', sandboxMode: 'off' },
  schedule: { type: 'recurring', cron: '0 9 * * *', preset: 'daily', timeOfDay: '09:00' },
  ...overrides,
})

function createMockDb() {
  const runMock = vi.fn().mockReturnValue({ changes: 1 })
  const getMock = vi.fn()
  const allMock = vi.fn().mockReturnValue([])
  const prepareMock = vi.fn().mockReturnValue({ run: runMock, get: getMock, all: allMock })
  getDbMock.mockReturnValue({ prepare: prepareMock })
  return { prepareMock, runMock, getMock, allMock }
}

describe('computeNextRunAt', () => {
  it('returns runAt for one-time schedule', () => {
    const schedule: AutomationSchedule = { type: 'one-time', runAt: '2026-05-01T09:00:00.000Z' }
    expect(computeNextRunAt(schedule)).toBe('2026-05-01T09:00:00.000Z')
  })

  it('returns undefined for one-time without runAt', () => {
    const schedule: AutomationSchedule = { type: 'one-time' }
    expect(computeNextRunAt(schedule)).toBeUndefined()
  })

  it('uses croner for recurring schedule', () => {
    const schedule: AutomationSchedule = { type: 'recurring', cron: '0 9 * * *' }
    expect(computeNextRunAt(schedule)).toBe('2026-05-01T09:00:00.000Z')
  })

  it('returns undefined for recurring without cron', () => {
    const schedule: AutomationSchedule = { type: 'recurring' }
    expect(computeNextRunAt(schedule)).toBeUndefined()
  })
})

describe('listAutomationsForProject', () => {
  beforeEach(() => { getDbMock.mockReset(); getProjectIdMock.mockReset() })

  it('returns empty when project not found', () => {
    getProjectIdMock.mockReturnValue(null)
    expect(listAutomationsForProject('/unknown')).toEqual([])
  })

  it('maps DB rows to Automation objects', () => {
    getProjectIdMock.mockReturnValue(PROJECT_ID)
    const rows = [{
      id: 'a1',
      project_id: PROJECT_ID,
      name: 'Test',
      prompt: 'Do something',
      agent_config_json: '{"type":"claude","permissionMode":"bypassPermissions"}',
      schedule_json: '{"type":"recurring","cron":"0 9 * * *"}',
      enabled: 1,
      last_run_at: null,
      last_run_status: null,
      last_run_session_id: null,
      next_run_at: '2026-05-01T09:00:00.000Z',
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    }]
    const allMock = vi.fn().mockReturnValue(rows)
    getDbMock.mockReturnValue({ prepare: vi.fn().mockReturnValue({ all: allMock }) })

    const result = listAutomationsForProject(PROJECT_PATH)

    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('a1')
    expect(result[0].name).toBe('Test')
    expect(result[0].agentConfig).toEqual({ type: 'claude', permissionMode: 'bypassPermissions' })
    expect(result[0].enabled).toBe(true)
    expect(result[0].projectPath).toBe(PROJECT_PATH)
  })
})

describe('createAutomation', () => {
  beforeEach(() => { getDbMock.mockReset(); getProjectIdMock.mockReset() })

  it('throws when project not found', () => {
    getProjectIdMock.mockReturnValue(null)
    expect(() => createAutomation('/unknown', makeClaudeRequest())).toThrow('Project not found')
  })

  it('inserts with computed nextRunAt', () => {
    getProjectIdMock.mockReturnValue(PROJECT_ID)
    const { prepareMock, runMock, getMock } = createMockDb()
    getMock.mockReturnValue({
      id: 'new-id',
      project_id: PROJECT_ID,
      project_path: PROJECT_PATH,
      name: 'Daily Review',
      prompt: 'Review recent commits',
      agent_config_json: '{"type":"claude"}',
      schedule_json: '{"type":"recurring","cron":"0 9 * * *"}',
      enabled: 1,
      last_run_at: null,
      last_run_status: null,
      last_run_session_id: null,
      next_run_at: '2026-05-01T09:00:00.000Z',
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    })

    createAutomation(PROJECT_PATH, makeClaudeRequest())

    const insertCall = runMock.mock.calls[0]
    expect(insertCall).toBeDefined()
    expect(insertCall[2]).toBe('Daily Review')
    expect(insertCall[3]).toBe('Review recent commits')
  })
})

describe('updateAutomation', () => {
  beforeEach(() => { getDbMock.mockReset(); getProjectIdMock.mockReset() })

  it('returns undefined when automation not found', () => {
    const { getMock } = createMockDb()
    getMock.mockReturnValue(undefined)
    expect(updateAutomation('nonexistent', { name: 'New' })).toBeUndefined()
  })

  it('re-enables when schedule is updated', () => {
    const existing = {
      id: 'a1',
      project_id: PROJECT_ID,
      project_path: PROJECT_PATH,
      name: 'Test',
      prompt: 'Do something',
      agent_config_json: '{"type":"claude","permissionMode":"bypassPermissions"}',
      schedule_json: '{"type":"one-time","runAt":"2026-04-20T09:00:00.000Z"}',
      enabled: 0,
      last_run_at: '2026-04-15T00:00:00.000Z',
      last_run_status: 'completed',
      last_run_session_id: 's1',
      next_run_at: null,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    }
    const { runMock, getMock } = createMockDb()
    getMock.mockReturnValue(existing)

    const newSchedule: AutomationSchedule = { type: 'one-time', runAt: '2026-05-01T09:00:00.000Z' }
    updateAutomation('a1', { schedule: newSchedule })

    const updateCall = runMock.mock.calls[0]
    const enabledArg = updateCall[4]
    expect(enabledArg).toBe(1)
  })

  it('keeps enabled state when only name changes', () => {
    const existing = {
      id: 'a1',
      project_id: PROJECT_ID,
      project_path: PROJECT_PATH,
      name: 'Test',
      prompt: 'Do something',
      agent_config_json: '{"type":"claude","permissionMode":"bypassPermissions"}',
      schedule_json: '{"type":"recurring","cron":"0 9 * * *"}',
      enabled: 0,
      last_run_at: null,
      last_run_status: null,
      last_run_session_id: null,
      next_run_at: null,
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    }
    const { runMock, getMock } = createMockDb()
    getMock.mockReturnValue(existing)

    updateAutomation('a1', { name: 'Renamed' })

    const updateCall = runMock.mock.calls[0]
    const enabledArg = updateCall[4]
    expect(enabledArg).toBe(0)
  })
})

describe('deleteAutomation', () => {
  it('returns true when deleted', () => {
    const { runMock } = createMockDb()
    runMock.mockReturnValue({ changes: 1 })
    expect(deleteAutomation('a1')).toBe(true)
  })

  it('returns false when not found', () => {
    const { runMock } = createMockDb()
    runMock.mockReturnValue({ changes: 0 })
    expect(deleteAutomation('nonexistent')).toBe(false)
  })
})

describe('listDueAutomations', () => {
  beforeEach(() => { getDbMock.mockReset() })

  it('returns automations due before given time', () => {
    const rows = [{
      id: 'a1',
      project_id: PROJECT_ID,
      project_path: PROJECT_PATH,
      name: 'Due Task',
      prompt: 'Run this',
      agent_config_json: '{"type":"claude","permissionMode":"bypassPermissions"}',
      schedule_json: '{"type":"recurring","cron":"0 9 * * *"}',
      enabled: 1,
      last_run_at: null,
      last_run_status: null,
      last_run_session_id: null,
      next_run_at: '2026-04-15T09:00:00.000Z',
      created_at: '2026-04-15T00:00:00.000Z',
      updated_at: '2026-04-15T00:00:00.000Z',
    }]
    const allMock = vi.fn().mockReturnValue(rows)
    getDbMock.mockReturnValue({ prepare: vi.fn().mockReturnValue({ all: allMock }) })

    const result = listDueAutomations('2026-04-15T10:00:00.000Z')

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Due Task')
  })
})

describe('updateAutomationRunStatus', () => {
  beforeEach(() => { getDbMock.mockReset() })

  it('sets only status when running', () => {
    const { prepareMock, runMock } = createMockDb()
    updateAutomationRunStatus('a1', 'running')

    const sql = prepareMock.mock.calls[0][0] as string
    expect(sql).toContain('last_run_status')
    expect(sql).not.toContain('last_run_at')
    expect(runMock.mock.calls[0][0]).toBe('running')
  })

  it('sets full status on completion', () => {
    const { prepareMock, runMock } = createMockDb()
    updateAutomationRunStatus('a1', 'completed', 'session-123', '2026-05-01T09:00:00.000Z')

    const sql = prepareMock.mock.calls[0][0] as string
    expect(sql).toContain('last_run_at')
    expect(sql).toContain('last_run_session_id')
    expect(sql).toContain('next_run_at')
    expect(runMock.mock.calls[0][1]).toBe('completed')
    expect(runMock.mock.calls[0][2]).toBe('session-123')
  })
})

describe('refreshAllNextRunAt', () => {
  it('updates nextRunAt for all enabled automations', () => {
    const rows = [
      { id: 'a1', schedule_json: '{"type":"recurring","cron":"0 9 * * *"}' },
      { id: 'a2', schedule_json: '{"type":"one-time","runAt":"2026-05-01T09:00:00.000Z"}' },
    ]
    const allMock = vi.fn().mockReturnValue(rows)
    const runMock = vi.fn()
    const transactionMock = vi.fn((fn: () => void) => () => fn())
    getDbMock.mockReturnValue({
      prepare: vi.fn().mockReturnValue({ all: allMock, run: runMock }),
      transaction: transactionMock,
    })

    refreshAllNextRunAt()

    expect(transactionMock).toHaveBeenCalled()
    expect(runMock).toHaveBeenCalledTimes(2)
    expect(runMock).toHaveBeenCalledWith('2026-05-01T09:00:00.000Z', 'a1')
    expect(runMock).toHaveBeenCalledWith('2026-05-01T09:00:00.000Z', 'a2')
  })
})

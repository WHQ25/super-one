import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Automation } from '@superone/shared/agent-types'

const db = vi.hoisted(() => ({
  rows: new Map<string, Automation & { projectId: string }>(),
}))
const service = vi.hoisted(() => ({
  notifyAutomationsListChanged: vi.fn(),
  runAutomationNow: vi.fn(async () => ({ status: 'completed' as const, sessionId: 's-1' })),
}))

vi.mock('../db-automations', () => ({
  listAutomationsForProject: (path: string) => [...db.rows.values()].filter((row) => row.projectPath === path),
  getAutomation: (id: string) => db.rows.get(id),
  createAutomation: (projectPath: string, data: Omit<Automation, 'id' | 'projectPath' | 'enabled' | 'createdAt' | 'updatedAt'>) => {
    const row = { ...data, id: `a-${db.rows.size + 1}`, projectId: 'p1', projectPath, enabled: true, createdAt: '', updatedAt: '' }
    db.rows.set(row.id, row)
    return row
  },
  updateAutomation: (id: string, data: Partial<Automation>) => {
    const row = db.rows.get(id)
    if (!row) return undefined
    db.rows.set(id, { ...row, ...data })
    return db.rows.get(id)
  },
  deleteAutomation: (id: string) => db.rows.delete(id),
}))
vi.mock('../automation-service', () => service)

import { createDesktopAutomationsPort } from './desktop-automations-port'

const request = {
  name: 'Nightly',
  prompt: 'Run the tests',
  agentConfig: { type: 'claude' as const },
  schedule: { type: 'recurring' as const, cron: '0 3 * * *' },
}

describe('createDesktopAutomationsPort', () => {
  beforeEach(() => {
    db.rows.clear()
    vi.clearAllMocks()
  })

  it("re-lists the window's sidebar after each change a client makes", () => {
    const { automations } = createDesktopAutomationsPort()
    const created = automations.create('p1', '/repo', request)
    expect(created).toMatchObject({ projectId: 'p1', projectPath: '/repo', name: 'Nightly' })
    expect(automations.listForProject('p1', '/repo')).toEqual([expect.objectContaining({ id: created.id, projectId: 'p1' })])

    expect(automations.update(created.id, { enabled: false })).toMatchObject({ enabled: false })
    expect(automations.update('missing', { enabled: false })).toBeUndefined()
    expect(automations.delete(created.id)).toBe(true)
    expect(automations.delete(created.id)).toBe(false)

    expect(service.notifyAutomationsListChanged.mock.calls).toEqual([['/repo'], ['/repo'], ['/repo']])
  })

  it('runs on the scheduler the window uses and reports how the run ended', async () => {
    const { automationService } = createDesktopAutomationsPort()
    await expect(automationService.runNow('a-1')).resolves.toEqual({ status: 'completed', sessionId: 's-1' })
    expect(service.runAutomationNow).toHaveBeenCalledWith('a-1')
  })
})

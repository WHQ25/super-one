import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, OpenCodeResources } from '@superone/shared/agent-types'

const db = vi.hoisted(() => ({
  resources: null as OpenCodeResources | null,
  meta: null as { ageMs: number; cacheKey: string | null } | null,
}))
const probe = vi.hoisted(() => vi.fn())
vi.mock('../database', () => ({
  getCachedHarnessResources: () => db.resources,
  getHarnessResourceCacheMeta: () => db.meta,
  setCachedHarnessResources: (_id: string, resources: OpenCodeResources, cacheKey: string) => {
    db.resources = resources
    db.meta = { ageMs: 0, cacheKey }
  },
}))
vi.mock('../logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('./opencode-runtime', () => ({ probeOpenCodeResources: probe }))

import { connectOpenCodeResources } from './opencode-resources'
import { buildRemoteHarnessSystemInfo } from '../agent/remote-harness-system-info'

const resources: OpenCodeResources = {
  models: [{ id: 'openai/gpt', name: 'GPT', description: '', supportedEffortLevels: ['low', 'high'] }],
  agents: [{ id: 'build', name: 'Build', description: 'Implement changes' }],
  commands: [{ name: 'review', description: 'Review changes', argumentHint: '', isSkill: false }],
}

describe('OpenCode discovery before any desktop session', () => {
  beforeEach(() => {
    db.resources = null
    db.meta = null
    probe.mockReset().mockResolvedValue(resources)
  })

  it('returns models, agents and commands to mobile with an empty desktop cache', async () => {
    const info = await buildRemoteHarnessSystemInfo('/project', 'opencode', {
      settings: { agentPreference: { opencode: {} } } as AppSettings,
      currentLocale: 'en',
      getCachedResources: () => null,
      fetchClaudeModels: async () => [],
      activeProvider: () => null,
      connectOpenCodeResources,
    })
    expect(probe).toHaveBeenCalledWith({ cwd: '/project' })
    expect(info.models).toEqual(resources.models)
    expect(info.agents).toEqual(resources.agents)
    expect(info.slashCommands).toEqual(resources.commands)
    expect(info.permissionModes).toEqual([])
    expect(info.selectedAgentId).toBeNull()
    expect(db.resources).toEqual(resources)
  })

  it('shares concurrent catalog requests and reuses the resulting fresh cache', async () => {
    const [first, second] = await Promise.all([
      connectOpenCodeResources('/project'), connectOpenCodeResources('/project'),
    ])
    expect(first).toEqual(resources)
    expect(second).toEqual(resources)
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(resources)
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('probes a different project instead of reusing its agents and commands', async () => {
    await connectOpenCodeResources('/project')
    const other = { ...resources, agents: [{ id: 'reviewer', name: 'Reviewer' }] }
    probe.mockResolvedValueOnce(other)
    await expect(connectOpenCodeResources('/other')).resolves.toEqual(other)
    expect(probe).toHaveBeenCalledTimes(2)
    expect(db.meta?.cacheKey).toBe('/other')
  })

  it.each(['models', 'agents'] as const)('retries discovery when the cached %s catalog has not settled', async (catalog) => {
    const partial = { ...resources, [catalog]: [] }
    probe.mockResolvedValueOnce(partial)
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(partial)
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(resources)
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('retains stale resources from the same project when ordinary discovery fails', async () => {
    await connectOpenCodeResources('/project')
    db.meta!.ageMs = 24 * 60 * 60 * 1000
    probe.mockRejectedValueOnce(new Error('unavailable'))
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(resources)
  })

  it('reports a failed forced refresh and keeps the existing catalog available', async () => {
    await connectOpenCodeResources('/project')
    probe.mockRejectedValueOnce(new Error('unavailable'))
    await expect(connectOpenCodeResources('/project', true)).rejects.toThrow('unavailable')
    expect(db.resources).toEqual(resources)
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(resources)
  })

  it('reports cold-start failure and allows a subsequent retry without another project cache', async () => {
    await connectOpenCodeResources('/other')
    probe.mockRejectedValueOnce(new Error('unavailable'))
    await expect(connectOpenCodeResources('/project')).rejects.toThrow('unavailable')
    await expect(connectOpenCodeResources('/project')).resolves.toEqual(resources)
    expect(probe).toHaveBeenCalledTimes(3)
  })
})

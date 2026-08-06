import { beforeEach, describe, expect, it } from 'vitest'
import type { ModelOption } from '@superone/shared/agent-types'
import {
  getNodeClaudeModelCatalog,
  resetNodeClaudeModelCatalogForTests,
} from './claude-model-catalog'

const MODELS: ModelOption[] = [{ id: 'opus[1m]', name: 'Opus 5 1M', description: '' }]

beforeEach(() => {
  resetNodeClaudeModelCatalogForTests()
})

describe('getNodeClaudeModelCatalog', () => {
  it('probes the harness once and serves the cached catalog within the TTL', async () => {
    let calls = 0
    let now = 1_000
    const fetchModels = async () => {
      calls += 1
      return MODELS
    }

    const first = await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels, now: () => now })
    now += 60_000
    const second = await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels, now: () => now })

    expect(first.map((m) => m.id)).toEqual(['opus[1m]'])
    expect(second).toEqual(first)
    expect(calls).toBe(1)
  })

  it('re-probes once the cached catalog goes stale', async () => {
    let calls = 0
    let now = 1_000
    const fetchModels = async () => {
      calls += 1
      return MODELS
    }

    await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels, now: () => now })
    now += 60 * 60_000
    await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels, now: () => now })

    expect(calls).toBe(2)
  })

  it('re-probes after a failed probe instead of caching the empty catalog', async () => {
    let calls = 0
    const fetchModels = async () => {
      calls += 1
      return calls === 1 ? [] : MODELS
    }

    expect(await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels })).toEqual([])
    expect((await getNodeClaudeModelCatalog({ cwd: '/work', fetchModels })).map((m) => m.id)).toEqual([
      'opus[1m]',
    ])
    expect(calls).toBe(2)
  })

  it('does not serve one binary catalog for another', async () => {
    const seen: Array<string | null | undefined> = []
    const fetchModels = async (opts: { binaryPath?: string | null }) => {
      seen.push(opts.binaryPath)
      return MODELS
    }

    await getNodeClaudeModelCatalog({ cwd: '/work', binaryPath: '/a/claude', fetchModels })
    await getNodeClaudeModelCatalog({ cwd: '/work', binaryPath: '/b/claude', fetchModels })

    expect(seen).toEqual(['/a/claude', '/b/claude'])
  })
})

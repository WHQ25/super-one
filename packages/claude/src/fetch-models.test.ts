import { describe, expect, it, vi } from 'vitest'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { fetchClaudeModels, mapClaudeModelInfo } from './fetch-models'
import type { ClaudeQueryFn } from './types'

/** Shape returned by `query().supportedModels()` (Agent SDK 0.3.x). */
const SDK_MODELS = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 with 1M context · Best for everyday, complex tasks',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
    supportsAdaptiveThinking: true,
    supportsFastMode: true,
    supportsAutoMode: true,
  },
  {
    value: 'haiku',
    resolvedModel: 'claude-haiku-4-5',
    displayName: 'Haiku',
    description: 'Haiku 4.5 · Fastest',
  },
]

function stubQuery(models: unknown[], capture?: (options?: Options) => void) {
  const close = vi.fn()
  const queryFn = vi.fn((({ options }: { options?: Options }) => {
    capture?.(options)
    return {
      initializationResult: async () => ({}),
      supportedModels: async () => models,
      close,
      [Symbol.asyncIterator]: async function* () {},
    }
  }) as unknown as ClaudeQueryFn)
  return { queryFn, close }
}

describe('mapClaudeModelInfo', () => {
  it('takes the concise model name out of the description', () => {
    expect(mapClaudeModelInfo(SDK_MODELS[0]!)).toMatchObject({
      id: 'default',
      name: 'Opus 5 1M',
      resolvedModel: 'claude-opus-5[1m]',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
      supportsAutoMode: true,
    })
  })

  it('falls back to displayName when the description has no name segment', () => {
    expect(mapClaudeModelInfo({ value: 'sonnet', displayName: 'Sonnet', description: 'Fast' }))
      .toMatchObject({ id: 'sonnet', name: 'Sonnet', description: 'Fast' })
  })
})

describe('fetchClaudeModels', () => {
  it('returns the catalog the harness process reports', async () => {
    const { queryFn, close } = stubQuery(SDK_MODELS)
    const models = await fetchClaudeModels({ cwd: '/work', queryFn })

    expect(models.map((m) => m.id)).toEqual(['default', 'haiku'])
    expect(models[0]).toMatchObject({ id: 'default', name: 'Opus 5 1M' })
    expect(close).toHaveBeenCalled()
  })

  it('probes with a permission mode that a root node can start', async () => {
    let seen: Options | undefined
    const { queryFn } = stubQuery(SDK_MODELS, (o) => {
      seen = o
    })
    await fetchClaudeModels({
      cwd: '/work',
      binaryPath: '/bin/claude',
      env: { ANTHROPIC_BASE_URL: 'https://example.test' },
      queryFn,
      uid: 0,
    })

    expect(seen?.cwd).toBe('/work')
    expect(seen?.pathToClaudeCodeExecutable).toBe('/bin/claude')
    expect(seen?.maxTurns).toBe(0)
    expect(seen?.permissionMode).not.toBe('bypassPermissions')
    expect(seen?.allowDangerouslySkipPermissions).not.toBe(true)
    expect((seen?.env as Record<string, string>)?.ANTHROPIC_BASE_URL).toBe('https://example.test')
  })

  it('returns an empty catalog instead of throwing when the probe fails', async () => {
    const queryFn = vi.fn((() => {
      throw new Error('spawn failed')
    }) as unknown as ClaudeQueryFn)
    await expect(fetchClaudeModels({ cwd: '/work', queryFn })).resolves.toEqual([])
  })
})

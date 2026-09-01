import { describe, expect, it } from 'vitest'
import type { ModelOption, ProviderModelEnv } from '@superone/shared/agent-types'
import { resolveClaudeEntries } from './ModelSelectorLists'

/** Shape of the official catalog the SDK reports: each alias plus its 1M row. */
const CATALOG: ModelOption[] = [
  { id: 'opus[1m]', name: 'Opus 5 (1M)', description: '1M context' },
  { id: 'opus', name: 'Opus 5', description: 'Most capable' },
  { id: 'sonnet', name: 'Sonnet 5', description: 'Balanced' },
  { id: 'haiku', name: 'Haiku 4.5', description: 'Fastest' },
]

const TOKEN_PLAN: ProviderModelEnv = {
  opus: { id: 'qwen3.8-max', name: 'Qwen3.8 Max' },
  sonnet: { id: 'qwen3.8-plus', name: 'Qwen3.8 Plus' },
}

describe('resolveClaudeEntries', () => {
  it('passes the catalog through untouched with no mapping', () => {
    const entries = resolveClaudeEntries(CATALOG, null)
    expect(entries.map((e) => e.model.id)).toEqual(['opus[1m]', 'opus', 'sonnet', 'haiku'])
    expect(entries[0].displayName).toBe('Opus 5 (1M)')
  })

  it('collapses a mapped bucket onto the plain alias, never the [1m] row', () => {
    // The two opus rows render as one indistinguishable "Qwen3.8 Max" row, so
    // selecting it must yield `opus` — `opus[1m]` would reach the provider as
    // `qwen3.8-max[1m]` and 404.
    const entries = resolveClaudeEntries(CATALOG, TOKEN_PLAN)
    const opusEntry = entries.find((e) => e.displayName === 'Qwen3.8 Max')
    expect(opusEntry?.model.id).toBe('opus')
    expect(entries.filter((e) => e.displayName === 'Qwen3.8 Max')).toHaveLength(1)
  })

  it('keeps the row selectable when the catalog ships no plain alias', () => {
    // Degenerate catalog: nothing to prefer, so the row keeps a real catalog id
    // rather than a synthesized one (`currentModel` lookups match on it).
    // `resolveMappedClaudeModelId` is the backstop that strips it before spawn.
    const entries = resolveClaudeEntries([{ id: 'opus[1m]', name: 'Opus 5 (1M)', description: '1M context' }], TOKEN_PLAN)
    expect(entries.map((e) => e.model.id)).toEqual(['opus[1m]'])
  })

  it('leaves unmapped buckets on their own catalog identity', () => {
    const entries = resolveClaudeEntries(CATALOG, TOKEN_PLAN)
    const haiku = entries.find((e) => e.model.id === 'haiku')
    expect(haiku?.displayName).toBe('Haiku 4.5')
  })
})

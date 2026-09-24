import { describe, expect, it } from 'vitest'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { diffHeaders, projectHeader } from './header'

/** A baseline header: one model, a short prompt, two tools. */
const SYSTEM = 'line one\nline two\nline three\nline four\nline five'

const BASE = {
  config: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  tools: [
    { name: 'read', description: 'read a file', parameters: { type: 'object' } },
    { name: 'bash', description: 'run a command', parameters: { type: 'object' } },
  ],
} as EpochHeader

/** The header as the fold pairs it: with the system prompt logged beside it. */
function epoch(header: EpochHeader, system: string | null = SYSTEM) {
  return { header, system }
}

describe('projectHeader', () => {
  it('keeps the prompt and the full tool catalog', () => {
    const header = projectHeader(BASE, 0, 7, 1_000, 'initial', SYSTEM)

    expect(header).toMatchObject({ index: 0, seq: 7, time: 1_000, reason: 'initial' })
    expect(header.system?.text).toBe(SYSTEM)
    expect(header.tools.map((tool) => tool.name)).toEqual(['read', 'bash'])
  })

  it('reports adapter-materialized fields only when the adapter supplied one', () => {
    expect(projectHeader(BASE, 0, 0, 0, 'initial', null).adapterDefaults).toBeNull()
    const resolved = { ...BASE, adapterDefaults: { maxTokens: true } } as EpochHeader
    expect(projectHeader(resolved, 0, 0, 0, 'resume', null).adapterDefaults).toEqual({ maxTokens: true })
  })
})

describe('diffHeaders', () => {
  it('has nothing to compare for the first snapshot', () => {
    expect(diffHeaders(null, epoch(BASE))).toBeNull()
  })

  it('reports changed config fields as before/after pairs', () => {
    const after = { ...BASE, config: { ...BASE.config, model: 'deepseek-reasoner', temperature: undefined } } as EpochHeader

    expect(diffHeaders(epoch(BASE), epoch(after))?.config).toEqual([
      { field: 'model', before: 'deepseek-chat', after: 'deepseek-reasoner' },
      { field: 'temperature', before: '0.2', after: null },
    ])
  })

  it('collapses the system prompt to the changed region plus context', () => {
    const diff = diffHeaders(epoch(BASE), epoch(BASE, SYSTEM.replace('line three', 'line three (edited)')))

    expect(diff?.systemChanged).toBe(true)
    expect(diff?.systemHunks).toHaveLength(1)
    expect(diff?.systemHunks[0]?.lines).toContain('-line three')
    expect(diff?.systemHunks[0]?.lines).toContain('+line three (edited)')
  })

  it('reports no system hunks when only the tool catalog moved', () => {
    const after = {
      ...BASE,
      tools: [
        { name: 'read', description: 'read a file', parameters: { type: 'object' } },
        { name: 'grep', description: 'search', parameters: { type: 'object' } },
      ],
    } as EpochHeader
    const diff = diffHeaders(epoch(BASE), epoch(after))

    expect(diff?.systemChanged).toBe(false)
    expect(diff?.systemHunks).toEqual([])
    expect(diff).toMatchObject({ toolsAdded: ['grep'], toolsRemoved: ['bash'], toolsChanged: [] })
  })

  it('separates a retitled tool from an added one', () => {
    const after = {
      ...BASE,
      tools: [
        { name: 'read', description: 'read a file, optionally a byte range', parameters: { type: 'object' } },
        { name: 'bash', description: 'run a command', parameters: { type: 'object' } },
      ],
    } as EpochHeader

    expect(diffHeaders(epoch(BASE), epoch(after))).toMatchObject({ toolsAdded: [], toolsRemoved: [], toolsChanged: ['read'] })
  })
})

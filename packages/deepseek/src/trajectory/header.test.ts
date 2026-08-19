import { describe, expect, it } from 'vitest'
import type { EpochHeader } from '@deepseek-ai/dsh-session'
import { diffHeaders, projectHeader } from './header'

/** A baseline header: one model, a short prompt, two tools. */
const BASE = {
  config: { provider: 'deepseek', model: 'deepseek-chat', temperature: 0.2 },
  system: 'line one\nline two\nline three\nline four\nline five',
  tools: [
    { name: 'read', description: 'read a file', parameters: { type: 'object' } },
    { name: 'bash', description: 'run a command', parameters: { type: 'object' } },
  ],
} as EpochHeader

describe('projectHeader', () => {
  it('keeps the prompt and the full tool catalog', () => {
    const header = projectHeader(BASE, 0, 7, 1_000, 'initial')

    expect(header).toMatchObject({ index: 0, seq: 7, time: 1_000, reason: 'initial' })
    expect(header.system?.text).toBe(BASE.system)
    expect(header.tools.map((tool) => tool.name)).toEqual(['read', 'bash'])
  })

  it('reports adapter-materialized fields only when the adapter supplied one', () => {
    expect(projectHeader(BASE, 0, 0, 0, 'initial').adapterDefaults).toBeNull()
    const resolved = { ...BASE, adapterDefaults: { maxTokens: true } } as EpochHeader
    expect(projectHeader(resolved, 0, 0, 0, 'resume').adapterDefaults).toEqual({ maxTokens: true })
  })
})

describe('diffHeaders', () => {
  it('has nothing to compare for the first snapshot', () => {
    expect(diffHeaders(null, BASE)).toBeNull()
  })

  it('reports changed config fields as before/after pairs', () => {
    const after = { ...BASE, config: { ...BASE.config, model: 'deepseek-reasoner', temperature: undefined } } as EpochHeader

    expect(diffHeaders(BASE, after)?.config).toEqual([
      { field: 'model', before: 'deepseek-chat', after: 'deepseek-reasoner' },
      { field: 'temperature', before: '0.2', after: null },
    ])
  })

  it('collapses the system prompt to the changed region plus context', () => {
    const after = { ...BASE, system: BASE.system!.replace('line three', 'line three (edited)') } as EpochHeader
    const diff = diffHeaders(BASE, after)

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
    const diff = diffHeaders(BASE, after)

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

    expect(diffHeaders(BASE, after)).toMatchObject({ toolsAdded: [], toolsRemoved: [], toolsChanged: ['read'] })
  })
})

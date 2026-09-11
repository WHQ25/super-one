import { describe, expect, it } from 'vitest'
import { mcpIconMapFromSources, mcpIconSourcesFrom, resolveMcpServerIcon, resolveMcpServerIconFromMap } from './mcp-server-icon'

describe('mcpIconSourcesFrom', () => {
  it('appends library, then bundles, then meta so meta wins on lookup', () => {
    const sources = mcpIconSourcesFrom({
      library: [{ name: 'github', icons: [{ src: 'lib.png' }] }],
      bundles: [{ meta: { name: 'linear' }, iconDataUrl: 'bundle.png' }],
      meta: { github: { name: 'github', icons: [{ src: 'meta.png' }] } },
    })
    expect(sources).toEqual([
      { name: 'github', src: 'lib.png' },
      { name: 'linear', src: 'bundle.png' },
      { name: 'github', src: 'meta.png' },
    ])
    expect(resolveMcpServerIcon('github', sources)).toBe('meta.png')
    expect(resolveMcpServerIcon('linear', sources)).toBe('bundle.png')
  })

  it('skips entries with no src', () => {
    expect(mcpIconSourcesFrom({
      library: [{ name: 'empty', icons: [] }],
      bundles: [{ meta: { name: 'no-icon' } }],
      meta: { blank: { name: 'blank', icons: [{ src: '' }] } },
    })).toEqual([])
  })
})

describe('resolveMcpServerIcon', () => {
  const sources = [
    { name: 'github', src: 'github.png' },
    { name: 'GitHub', src: 'GitHub.png' },
    { name: 'context7', src: 'c7.png' },
  ]

  it('prefers an exact name match over a case-insensitive one', () => {
    expect(resolveMcpServerIcon('GitHub', sources)).toBe('GitHub.png')
    expect(resolveMcpServerIcon('github', sources)).toBe('github.png')
  })

  it('falls back to a case-insensitive match for Grok server names', () => {
    expect(resolveMcpServerIcon('CONTEXT7', sources)).toBe('c7.png')
  })

  it('returns undefined when nothing matches', () => {
    expect(resolveMcpServerIcon('linear', sources)).toBeUndefined()
    expect(resolveMcpServerIcon('  ', sources)).toBeUndefined()
  })
})

describe('mcpIconMapFromSources', () => {
  it('keeps the last src for a repeated name', () => {
    expect(mcpIconMapFromSources([
      { name: 'github', src: 'lib.png' },
      { name: 'github', src: 'meta.png' },
    ])).toEqual({ github: 'meta.png' })
  })
})

describe('resolveMcpServerIconFromMap', () => {
  it('matches Grok casing against the config key', () => {
    expect(resolveMcpServerIconFromMap('GitHub', { github: 'g.png' })).toBe('g.png')
    expect(resolveMcpServerIconFromMap('github', { github: 'g.png' })).toBe('g.png')
  })
})

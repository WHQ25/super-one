import { describe, expect, it } from 'vitest'
import { mcpAppFileExtension, mcpAppFileExtensions } from './mcp-app-files'

describe('MCP App file entrypoints', () => {
  it('reads lowercased dot-form extensions from file entrypoints only', () => {
    expect(mcpAppFileExtensions({ name: 'cad.open', _meta: { 'openai/ui': { entrypoints: [
      { type: 'global' },
      { type: 'file', extensions: ['.STL', '.step', 'stp', '', '.a.b', '../x', 42] },
      { type: 'file', extensions: ['.stl', '.3mf'] },
    ] } } })).toEqual(['.stl', '.step', '.3mf'])
  })

  it('ignores tools without entrypoints or with malformed metadata', () => {
    expect(mcpAppFileExtensions({ name: 'plain' })).toEqual([])
    expect(mcpAppFileExtensions({ name: 'bad', _meta: { 'openai/ui': { entrypoints: { type: 'file' } } } })).toEqual([])
    expect(mcpAppFileExtensions({ name: 'bad', _meta: { 'openai/ui': [] } })).toEqual([])
  })

  it('takes the extension of the last path segment', () => {
    expect(mcpAppFileExtension('/work/parts/Hex-Bolt.STL')).toBe('.stl')
    expect(mcpAppFileExtension('C:\\work\\part.step')).toBe('.step')
    expect(mcpAppFileExtension('/work/.gitignore')).toBe('')
    expect(mcpAppFileExtension('/work.d/Makefile')).toBe('')
  })
})

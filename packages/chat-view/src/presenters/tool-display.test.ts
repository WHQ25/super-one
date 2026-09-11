import { describe, expect, it } from 'vitest'
import { getToolVerb } from './tool-display'

describe('getToolVerb', () => {
  it('uses the same live Bash label as the desktop terminal row', () => {
    expect(getToolVerb('Bash')).toBe('Running')
  })

  it('treats Grok qualified MCP names as Running, same as mcp__ rows', () => {
    expect(getToolVerb('mcp__GitHub__list_issues')).toBe('Running')
    expect(getToolVerb('GitHub__list_issues')).toBe('Running')
  })
})

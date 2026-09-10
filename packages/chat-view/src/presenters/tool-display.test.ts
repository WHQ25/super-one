import { describe, expect, it } from 'vitest'
import { getToolVerb } from './tool-display'

describe('getToolVerb', () => {
  it('uses the same live Bash label as the desktop terminal row', () => {
    expect(getToolVerb('Bash')).toBe('Running')
  })
})

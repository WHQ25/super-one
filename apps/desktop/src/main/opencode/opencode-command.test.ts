import { describe, expect, it } from 'vitest'
import { resolveOpenCodeCommandInvocation } from './opencode-command'

const commands = [
  { name: 'review', description: '', argumentHint: '', isSkill: false },
  { name: 'review deep', description: '', argumentHint: '', isSkill: false },
]

describe('resolveOpenCodeCommandInvocation', () => {
  it('matches the longest known command and preserves multiline arguments', () => {
    expect(resolveOpenCodeCommandInvocation('/review deep src\nwith context', commands)).toEqual({
      name: 'review deep',
      arguments: 'src\nwith context',
    })
  })

  it('does not treat unknown or partial names as SDK commands', () => {
    expect(resolveOpenCodeCommandInvocation('/unknown value', commands)).toBeNull()
    expect(resolveOpenCodeCommandInvocation('/reviewer value', commands)).toBeNull()
  })
})

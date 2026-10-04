import { describe, expect, it } from 'vitest'
import { grokAutoClassifierDenyText, withGrokAutoDenyPrefix } from './grok-auto-deny'

describe('grok auto classifier deny', () => {
  it('finds the classifier sentence in a historical tool result', () => {
    const text = 'Tool `Bash` was not executed: Auto mode blocked this action (shell)'
    expect(grokAutoClassifierDenyText(text)).toBe('Auto mode blocked this action (shell)')
    expect(grokAutoClassifierDenyText('User denied permission')).toBeNull()
  })

  it('prefixes the denied chrome once', () => {
    expect(withGrokAutoDenyPrefix('Tool `Bash` was not executed: Auto mode blocked this action'))
      .toBe('[denied] Tool `Bash` was not executed: Auto mode blocked this action')
    expect(withGrokAutoDenyPrefix('[denied] Auto mode blocked this action'))
      .toBe('[denied] Auto mode blocked this action')
    expect(withGrokAutoDenyPrefix('done')).toBe('done')
  })

  it('ignores the sentence when the tool ran or the result is not a failure', () => {
    const quoted = 'rg: Auto mode blocked this action (shell)'
    expect(grokAutoClassifierDenyText(quoted)).toBeNull()
    expect(withGrokAutoDenyPrefix(quoted)).toBe(quoted)
    const sentence = 'Tool `Bash` was not executed: Auto mode blocked this action (shell)'
    expect(withGrokAutoDenyPrefix(sentence, false)).toBe(sentence)
  })
})

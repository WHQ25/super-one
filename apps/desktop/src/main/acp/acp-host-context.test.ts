import { describe, expect, it } from 'vitest'
import { ACP_SYSTEM_PROMPT_BLOCK } from '../agent/superone-system-prompt'
import { acpHostContextText, isLeadingSlashPrompt } from './acp-host-context'

describe('isLeadingSlashPrompt', () => {
  it('detects a slash at the start of the user text', () => {
    expect(isLeadingSlashPrompt('/goal ship it')).toBe(true)
    expect(isLeadingSlashPrompt('  /loop 30m ping')).toBe(true)
    expect(isLeadingSlashPrompt('please /goal')).toBe(false)
    expect(isLeadingSlashPrompt('hello')).toBe(false)
  })
})

describe('acpHostContextText', () => {
  it('joins the host-context block with an optional append', () => {
    expect(acpHostContextText()).toBe(ACP_SYSTEM_PROMPT_BLOCK)
    expect(acpHostContextText('extra')).toBe(`${ACP_SYSTEM_PROMPT_BLOCK}\n\nextra`)
  })
})

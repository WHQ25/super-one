import { describe, it, expect } from 'vitest'
import { ACP_PERMISSION_MODES } from './acpPermissionModes'

describe('ACP_PERMISSION_MODES', () => {
  it('exposes Grok-wireable permission + plan modes', () => {
    expect(ACP_PERMISSION_MODES).toEqual(['default', 'plan', 'auto', 'bypassPermissions'])
  })

  it('includes plan but not Claude-only acceptEdits/dontAsk', () => {
    expect(ACP_PERMISSION_MODES).toContain('plan')
    expect(ACP_PERMISSION_MODES).not.toContain('acceptEdits')
    expect(ACP_PERMISSION_MODES).not.toContain('dontAsk')
  })
})

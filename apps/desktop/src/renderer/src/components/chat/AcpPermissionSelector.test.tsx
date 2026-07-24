import { describe, it, expect } from 'vitest'
import { ACP_PERMISSION_MODES } from './acpPermissionModes'

describe('ACP_PERMISSION_MODES', () => {
  it('exposes only Grok-wireable modes', () => {
    expect(ACP_PERMISSION_MODES).toEqual(['default', 'auto', 'bypassPermissions'])
  })

  it('does not use Claude plan/acceptEdits/dontAsk entries', () => {
    expect(ACP_PERMISSION_MODES).not.toContain('plan')
    expect(ACP_PERMISSION_MODES).not.toContain('acceptEdits')
    expect(ACP_PERMISSION_MODES).not.toContain('dontAsk')
  })
})

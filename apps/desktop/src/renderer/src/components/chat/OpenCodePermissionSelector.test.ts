import { describe, expect, it } from 'vitest'
import { OPENCODE_PERMISSION_MODES } from './opencodePermissionModes'

describe('OPENCODE_PERMISSION_MODES', () => {
  it('includes SDK-backed modes and excludes Claude Auto Mode', () => {
    expect(OPENCODE_PERMISSION_MODES).toEqual([
      'default',
      'plan',
      'acceptEdits',
      'dontAsk',
      'bypassPermissions',
    ])
    expect(OPENCODE_PERMISSION_MODES).not.toContain('auto')
  })
})

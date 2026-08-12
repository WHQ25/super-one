import { describe, expect, it } from 'vitest'
import { CURSOR_DEFAULT_PERMISSION_MODE, CURSOR_PERMISSION_MODES } from './cursorPermissionModes'

describe('CURSOR_PERMISSION_MODES', () => {
  it('offers Auto / Plan / Full Access only', () => {
    expect(CURSOR_PERMISSION_MODES).toEqual([
      'auto',
      'plan',
      'bypassPermissions',
    ])
    expect(CURSOR_DEFAULT_PERMISSION_MODE).toBe('auto')
    expect(CURSOR_PERMISSION_MODES).not.toContain('default')
    expect(CURSOR_PERMISSION_MODES).not.toContain('acceptEdits')
    expect(CURSOR_PERMISSION_MODES).not.toContain('dontAsk')
  })
})

import { describe, expect, it } from 'vitest'
import { CURSOR_DEFAULT_PERMISSION_MODE, CURSOR_PERMISSION_MODES, resolveCursorPermissionMode } from './cursorPermissionModes'

describe('CURSOR_PERMISSION_MODES', () => {
  it('offers Agent / Plan / Full Access only', () => {
    expect(CURSOR_PERMISSION_MODES).toEqual([
      'agent',
      'plan',
      'bypassPermissions',
    ])
    expect(CURSOR_DEFAULT_PERMISSION_MODE).toBe('agent')
    expect(CURSOR_PERMISSION_MODES).not.toContain('default')
    expect(CURSOR_PERMISSION_MODES).not.toContain('acceptEdits')
    expect(CURSOR_PERMISSION_MODES).not.toContain('dontAsk')
    expect(CURSOR_PERMISSION_MODES).not.toContain('auto')
  })

  it('maps legacy auto onto agent', () => {
    expect(resolveCursorPermissionMode('auto')).toBe('agent')
    expect(resolveCursorPermissionMode('default')).toBe('agent')
    expect(resolveCursorPermissionMode('plan')).toBe('plan')
  })
})

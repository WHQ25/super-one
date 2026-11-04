import { describe, it, expect } from 'vitest'
import {
  ACP_PERMISSION_MODES,
  ANTIGRAVITY_PERMISSION_MODES,
  ANTIGRAVITY_PERMISSION_MODE_META,
  acpPermissionModesForAgent,
} from './acpPermissionModes'

describe('ACP_PERMISSION_MODES', () => {
  it('exposes Grok-wireable permission + plan modes', () => {
    expect(ACP_PERMISSION_MODES).toEqual(['default', 'plan', 'auto', 'bypassPermissions'])
    expect(acpPermissionModesForAgent('grok-build')).toEqual(['default', 'plan', 'auto', 'bypassPermissions'])
  })

  it('includes plan but not Claude-only acceptEdits/dontAsk', () => {
    expect(ACP_PERMISSION_MODES).toContain('plan')
    expect(ACP_PERMISSION_MODES).not.toContain('acceptEdits')
    expect(ACP_PERMISSION_MODES).not.toContain('dontAsk')
  })

  it('exposes Antigravity modes with agy CLI colors (plan purple, acceptEdits lime, auto orange)', () => {
    expect(ANTIGRAVITY_PERMISSION_MODES).toEqual(['default', 'plan', 'acceptEdits', 'auto'])
    expect(acpPermissionModesForAgent('antigravity')).toEqual(['default', 'plan', 'acceptEdits', 'auto'])
    expect(ANTIGRAVITY_PERMISSION_MODE_META.find((m) => m.id === 'plan')?.color).toContain('purple')
    expect(ANTIGRAVITY_PERMISSION_MODE_META.find((m) => m.id === 'acceptEdits')?.color).toContain('lime')
    expect(ANTIGRAVITY_PERMISSION_MODE_META.find((m) => m.id === 'auto')?.color).toContain('orange')
  })
})

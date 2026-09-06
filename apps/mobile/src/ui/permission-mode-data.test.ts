import { describe, expect, it } from 'vitest'
import { orderedPermissionModes, permissionModeLabel, permissionPresentation } from './permission-mode-data'

describe('harness-specific permission presentation', () => {
  it('labels the same carrier mode according to the actual harness behavior', () => {
    expect(permissionModeLabel('plan', 'claude')).toBe('Plan Mode')
    expect(permissionModeLabel('plan', 'dsh')).toBe('Read-only')
    expect(permissionModeLabel('default', 'dsh')).toBe('Workspace write')
    expect(permissionModeLabel('agent', 'cursor')).toBe('Agent')
    expect(permissionModeLabel('default', 'acp')).toBe('Ask')
  })
  it('maps Codex wire modes to desktop preset labels without changing wire values', () => {
    expect(permissionPresentation('codex', 'auto').label).toBe('Approve for Me')
    expect(permissionPresentation('codex', 'bypassPermissions').triggerIcon).toBe('ShieldOff')
    expect(permissionModeLabel('full-access', 'codex')).toBe('Full Access')
    expect(orderedPermissionModes('codex', ['bypassPermissions', 'default', 'auto'])).toEqual(['default', 'auto', 'bypassPermissions'])
  })
  it('never inserts an unsupported desktop mode into a remote catalog', () => {
    expect(orderedPermissionModes('claude', ['plan', 'default'])).toEqual(['default', 'plan'])
    expect(orderedPermissionModes('codex', ['default', 'auto'])).not.toContain('read-only')
    expect(permissionModeLabel('custom-agent-policy', 'acp')).toBe('custom-agent-policy')
  })
})

import { describe, expect, it } from 'vitest'
import {
  ADMIN_PAIRING_SCOPES,
  AUTH_SCOPES,
  hasAllScopes,
  hasAnyScope,
  hasScope,
  OPERATION_SCOPES,
} from './auth'

describe('auth scopes', () => {
  it('includes the design-doc initial scope set', () => {
    expect(AUTH_SCOPES).toContain('environment:read')
    expect(AUTH_SCOPES).toContain('session:operate')
    expect(AUTH_SCOPES).toContain('node:admin')
    expect(ADMIN_PAIRING_SCOPES).toHaveLength(AUTH_SCOPES.length)
  })

  it('checks scope membership', () => {
    const granted = ['environment:read', 'session:read'] as const
    expect(hasScope(granted, 'environment:read')).toBe(true)
    expect(hasScope(granted, 'session:operate')).toBe(false)
    expect(hasAllScopes(granted, OPERATION_SCOPES.readEnvironment)).toBe(true)
    expect(hasAllScopes(granted, OPERATION_SCOPES.operateSession)).toBe(false)
    expect(hasAnyScope(granted, ['session:operate', 'session:read'])).toBe(true)
  })
})

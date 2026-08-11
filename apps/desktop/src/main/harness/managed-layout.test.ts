/**
 * Desktop re-export smoke — canonical tests live in
 * packages/runtime/src/harness/managed-layout.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { MANAGED_CURRENT_BASENAME, sanitizeRuntimeVersionForPath } from './managed-layout'

describe('managed-layout re-export', () => {
  it('exposes the shared canonical pointer name', () => {
    expect(MANAGED_CURRENT_BASENAME).toBe('current')
    expect(sanitizeRuntimeVersionForPath('0.3.226')).toBe('0.3.226')
  })
})

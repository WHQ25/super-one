import { describe, expect, it } from 'vitest'
import {
  ROOT_SAFE_PERMISSION_MODE,
  applyRootPermissionGuard,
  isRootWithoutSandboxOptIn,
} from './root-permission-guard'

/**
 * Claude Code refuses to start when it would skip permission prompts under
 * uid 0. Measured against the bundled Agent SDK binary (2.1.223) on Linux:
 *
 * | permissionMode     | allowDangerouslySkipPermissions | uid 0 result |
 * |--------------------|---------------------------------|--------------|
 * | default            | true                            | exit 1       |
 * | acceptEdits        | true                            | exit 1       |
 * | bypassPermissions  | true / false                    | exit 1       |
 * | acceptEdits        | false                           | starts       |
 * | default            | false                           | starts       |
 *
 * So both knobs have to be relaxed, not just the permission mode.
 */
describe('isRootWithoutSandboxOptIn', () => {
  it('is true for uid 0 with no sandbox opt-in', () => {
    expect(isRootWithoutSandboxOptIn({ uid: 0, env: {} })).toBe(true)
  })

  it('is false for a non-root uid', () => {
    expect(isRootWithoutSandboxOptIn({ uid: 1000, env: {} })).toBe(false)
  })

  it('is false when getuid is unavailable (Windows)', () => {
    expect(isRootWithoutSandboxOptIn({ uid: undefined, env: {} })).toBe(false)
  })

  it('is false when the host opts in via IS_SANDBOX=1', () => {
    expect(isRootWithoutSandboxOptIn({ uid: 0, env: { IS_SANDBOX: '1' } })).toBe(false)
  })

  it('is false under bubblewrap', () => {
    expect(isRootWithoutSandboxOptIn({ uid: 0, env: { CLAUDE_CODE_BUBBLEWRAP: '1' } })).toBe(false)
  })

  it('ignores IS_SANDBOX values other than 1', () => {
    expect(isRootWithoutSandboxOptIn({ uid: 0, env: { IS_SANDBOX: 'true' } })).toBe(true)
  })
})

describe('applyRootPermissionGuard', () => {
  it('leaves options untouched off root', () => {
    expect(
      applyRootPermissionGuard({
        permissionMode: 'bypassPermissions',
        uid: 1000,
        env: {},
      }),
    ).toEqual({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      applied: false,
      downgradedFrom: null,
    })
  })

  it('downgrades bypassPermissions and drops the skip flag under root', () => {
    expect(
      applyRootPermissionGuard({ permissionMode: 'bypassPermissions', uid: 0, env: {} }),
    ).toEqual({
      permissionMode: ROOT_SAFE_PERMISSION_MODE,
      allowDangerouslySkipPermissions: false,
      applied: true,
      downgradedFrom: 'bypassPermissions',
    })
  })

  it('drops the skip flag under root even when the mode is already safe', () => {
    // The flag alone is enough to make the process exit — this is why every
    // turn failed on a root node, not just the ones set to bypass.
    expect(applyRootPermissionGuard({ permissionMode: 'acceptEdits', uid: 0, env: {} })).toEqual({
      permissionMode: 'acceptEdits',
      allowDangerouslySkipPermissions: false,
      applied: true,
      downgradedFrom: null,
    })
  })

  it('keeps an unset mode unset', () => {
    expect(applyRootPermissionGuard({ permissionMode: undefined, uid: 0, env: {} })).toEqual({
      permissionMode: undefined,
      allowDangerouslySkipPermissions: false,
      applied: true,
      downgradedFrom: null,
    })
  })

  it('honours an explicit sandbox opt-in', () => {
    expect(
      applyRootPermissionGuard({
        permissionMode: 'bypassPermissions',
        uid: 0,
        env: { IS_SANDBOX: '1' },
      }),
    ).toEqual({
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      applied: false,
      downgradedFrom: null,
    })
  })

  it('trims whitespace-only modes to undefined', () => {
    expect(applyRootPermissionGuard({ permissionMode: '  ', uid: 1000, env: {} }).permissionMode)
      .toBeUndefined()
  })
})

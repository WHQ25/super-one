import { describe, it, expect } from 'vitest'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'
import { hasAnyPermission, permissionApprovalKeys } from './miniapp-permissions'

const base: MiniAppManifest = { appId: 'a', name: 'A' }

describe('miniapp permission model', () => {
  it('treats a background-only app as requiring approval (P1-a regression)', () => {
    const m: MiniAppManifest = { ...base, permissions: { background: { reason: 'finish download' } } }
    expect(hasAnyPermission(m)).toBe(true)
    expect(permissionApprovalKeys(m)).toEqual(['background'])
  })

  it('reports no permissions when manifest declares none', () => {
    expect(hasAnyPermission(base)).toBe(false)
    expect(hasAnyPermission({ ...base, permissions: {} })).toBe(false)
    expect(permissionApprovalKeys(base)).toEqual([])
  })

  it('collects a key per declared capability across all kinds', () => {
    const m: MiniAppManifest = {
      ...base,
      permissions: {
        fs: [{ scope: 'app', reason: 'r' }],
        network: [{ domain: 'x.com', reason: 'r' }],
        media: [{ kind: 'microphone', reason: 'r' }],
        storage: { reason: 'r' },
        background: { reason: 'r' },
      },
    }
    expect(hasAnyPermission(m)).toBe(true)
    expect(permissionApprovalKeys(m)).toEqual(['fs:0', 'net:x.com', 'media:microphone', 'storage', 'background'])
  })
})

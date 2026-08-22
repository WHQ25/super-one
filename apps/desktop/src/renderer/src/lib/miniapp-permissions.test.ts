import { describe, it, expect } from 'vitest'
import type { MiniAppManifest } from '@superone/shared/miniapp-types'
import { hasAnyPermission, permissionApprovalKeys } from './miniapp-permissions'

const base: MiniAppManifest = { appId: 'a', name: 'A', main: 'node.js' }

describe('miniapp permission model', () => {
  it('always requires approval for trusted MiniApp Host code', () => {
    expect(hasAnyPermission(base)).toBe(true)
    expect(hasAnyPermission({ ...base, permissions: {} })).toBe(true)
    expect(permissionApprovalKeys(base)).toEqual(['miniapp-host'])
  })

  it('collects a key for MiniApp Host trust and WebView capabilities', () => {
    const m: MiniAppManifest = {
      ...base,
      permissions: {
        network: [{ domain: 'x.com', reason: 'r' }],
        media: [{ kind: 'microphone', reason: 'r' }],
      },
    }
    expect(hasAnyPermission(m)).toBe(true)
    expect(permissionApprovalKeys(m)).toEqual(['miniapp-host', 'net:x.com', 'media:microphone'])
  })
})

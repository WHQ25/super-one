import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '/tmp', isPackaged: false }, dialog: { showMessageBox: vi.fn() } }))
vi.mock('./app-settings-service', () => ({ saveAppSettings: vi.fn() }))
vi.mock('./i18n', () => ({ t: (k: string) => k }))
vi.mock('./logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }))

import { needsIdentityHandoff, type HandoffInput } from './mac-identity-handoff'

const migrated: HandoffInput = {
  platform: 'darwin',
  packaged: true,
  bundleId: 'com.superone.desktop',
  macAppId: 'com.superone.desktop',
  seenBundleId: null,
  hasPriorData: true,
}

describe('needsIdentityHandoff', () => {
  it('fires once on the first new-id launch over data the old id left behind', () => {
    expect(needsIdentityHandoff(migrated)).toBe(true)
    // The marker written afterwards ends it.
    expect(needsIdentityHandoff({ ...migrated, seenBundleId: 'com.superone.desktop' })).toBe(false)
  })

  it('skips fresh installs: nothing to hand over, and no keychain item to explain', () => {
    expect(needsIdentityHandoff({ ...migrated, hasPriorData: false })).toBe(false)
  })

  it('skips bridge builds, which still run under the old id', () => {
    expect(needsIdentityHandoff({ ...migrated, bundleId: 'com.superone.app' })).toBe(false)
  })

  it('is macOS-packaged only', () => {
    expect(needsIdentityHandoff({ ...migrated, platform: 'win32' })).toBe(false)
    expect(needsIdentityHandoff({ ...migrated, packaged: false, bundleId: null })).toBe(false)
  })
})

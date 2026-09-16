import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type SelectHandler = (
  event: unknown,
  details: { relyingPartyId: string; accounts: Electron.WebAuthnAccount[]; frame: null },
  callback: (credentialId?: string | null) => void,
) => Promise<void>

const electron = vi.hoisted(() => ({
  configureWebAuthn: vi.fn(),
  sessionOn: vi.fn<(event: string, handler: SelectHandler) => void>(),
  showMessageBox: vi.fn(),
}))

vi.mock('electron', () => ({
  app: { configureWebAuthn: electron.configureWebAuthn },
  session: { fromPartition: () => ({ on: electron.sessionOn }) },
  dialog: { showMessageBox: electron.showMessageBox },
  webContents: { fromFrame: vi.fn() },
  BrowserWindow: { getFocusedWindow: () => null, fromWebContents: vi.fn() },
}))
vi.mock('../logger', () => ({ default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }))

import { accountLabel, registerBrowserWebAuthn, KEYCHAIN_ACCESS_GROUP } from './browser-webauthn'

const platform = process.platform
const setPlatform = (value: string) => Object.defineProperty(process, 'platform', { value })

const accounts: Electron.WebAuthnAccount[] = [
  { credentialId: 'cred-a', name: 'a@example.com', displayName: 'Alice' },
  { credentialId: 'cred-b', name: 'b@example.com' },
]

function registeredHandler(): SelectHandler {
  registerBrowserWebAuthn()
  const call = electron.sessionOn.mock.calls.find(([event]) => event === 'select-webauthn-account')
  if (!call) throw new Error('select-webauthn-account listener not registered')
  return call[1]
}

describe('registerBrowserWebAuthn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    setPlatform('darwin')
  })
  afterEach(() => setPlatform(platform))

  it('is a no-op off macOS', () => {
    setPlatform('win32')
    registerBrowserWebAuthn()
    expect(electron.configureWebAuthn).not.toHaveBeenCalled()
    expect(electron.sessionOn).not.toHaveBeenCalled()
  })

  it('enables the Touch ID authenticator under the entitled keychain group', () => {
    registerBrowserWebAuthn()
    expect(electron.configureWebAuthn).toHaveBeenCalledWith({
      touchID: expect.objectContaining({ keychainAccessGroup: KEYCHAIN_ACCESS_GROUP }),
    })
  })

  it('resolves the picked account through the callback', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 1 })
    const callback = vi.fn()
    await registeredHandler()(null, { relyingPartyId: 'example.com', accounts, frame: null }, callback)
    expect(electron.showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({ buttons: ['Alice (a@example.com)', 'b@example.com', 'Cancel'], cancelId: 2 }),
    )
    expect(callback).toHaveBeenCalledWith('cred-b')
  })

  it('cancels the request when the user dismisses the picker', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 2 })
    const callback = vi.fn()
    await registeredHandler()(null, { relyingPartyId: 'example.com', accounts, frame: null }, callback)
    expect(callback).toHaveBeenCalledWith(undefined)
  })

  it('still answers the request when the dialog throws', async () => {
    electron.showMessageBox.mockRejectedValue(new Error('no window'))
    const callback = vi.fn()
    await registeredHandler()(null, { relyingPartyId: 'example.com', accounts, frame: null }, callback)
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(undefined)
  })
})

describe('accountLabel', () => {
  it('falls back from display name to name to credential id', () => {
    expect(accountLabel({ credentialId: 'x', displayName: 'Only Display' })).toBe('Only Display')
    expect(accountLabel({ credentialId: 'x', name: 'same', displayName: 'same' })).toBe('same')
    expect(accountLabel({ credentialId: 'raw-id' })).toBe('raw-id')
  })
})

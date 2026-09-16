import { app, BrowserWindow, dialog, session, webContents } from 'electron'
import log from '../logger'

const BROWSER_PARTITION = 'persist:browser'

// Chromium only services WebAuthn platform-authenticator requests once the
// Touch ID / Secure Enclave authenticator is configured. Credentials land in
// the macOS keychain under this access group, which must also be listed in
// build/entitlements.mac.plist — so it only works in Developer ID-signed
// builds, not `bun run dev` or the ad-hoc dev bundle. One group serves every
// variant: Electron scopes credentials by a per-session metadata secret in
// userData, so stable/alpha never see each other's passkeys anyway.
export const KEYCHAIN_ACCESS_GROUP = 'T527W5ADUG.com.superone.app.webauthn'

export function accountLabel(account: Electron.WebAuthnAccount): string {
  const { name, displayName } = account
  if (name && displayName && name !== displayName) return `${displayName} (${name})`
  return displayName || name || account.credentialId
}

function ownerWindow(frame: Electron.WebFrameMain | null): BrowserWindow | null {
  const guest = frame ? webContents.fromFrame(frame) : undefined
  return guest ? BrowserWindow.fromWebContents(guest.hostWebContents ?? guest) : BrowserWindow.getFocusedWindow()
}

export function registerBrowserWebAuthn(): void {
  if (process.platform !== 'darwin') return
  app.configureWebAuthn({
    touchID: { keychainAccessGroup: KEYCHAIN_ACCESS_GROUP, promptReason: 'sign in to $1' },
  })

  // Electron ships no picker: with several discoverable credentials for one
  // relying party and no listener, `navigator.credentials.get()` fails with
  // NotAllowedError. A native message box is the first-cut picker; `finally`
  // guarantees the callback fires, since an unanswered request pends forever.
  session.fromPartition(BROWSER_PARTITION).on('select-webauthn-account', async (_event, details, callback) => {
    let credentialId: string | undefined
    try {
      const labels = details.accounts.map(accountLabel)
      const options: Electron.MessageBoxOptions = {
        type: 'question',
        title: 'Choose a passkey',
        message: `Which account do you want to use for ${details.relyingPartyId}?`,
        buttons: [...labels, 'Cancel'],
        defaultId: 0,
        cancelId: labels.length,
      }
      const win = ownerWindow(details.frame)
      const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
      credentialId = details.accounts[response]?.credentialId
    } catch (err) {
      log.error('[browser-webauthn] account picker failed: %s', err instanceof Error ? err.message : String(err))
    } finally {
      callback(credentialId)
    }
  })
}

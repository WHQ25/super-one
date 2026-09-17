import { app, BrowserWindow, dialog, session, webContents } from 'electron'
import log from '../logger'
import { macKeychainAccessGroup } from '../variant'

const BROWSER_PARTITION = 'persist:browser'

// Chromium only services WebAuthn platform-authenticator requests once the
// Touch ID / Secure Enclave authenticator is configured. Credentials land in
// the macOS keychain under an access group the main app's signature must
// list in `keychain-access-groups` — a restricted entitlement that
// build/mac-signing.cjs only signs when a Developer ID provisioning profile
// is supplied (without one AMFI kills the app at exec). The group is
// `<team>.com.superone.app.webauthn`, team-prefixed from the profile and read
// back from the packaged package.json; a build without a profile has no group
// and leaves the authenticator off, so `bun run dev`, the ad-hoc dev bundle,
// a contributor's unsigned build and the bridge build all launch fine with
// passkeys simply unavailable. The group is deliberately NOT tied to the
// bundle id: the profile grants `<team>.*`, and changing it would orphan
// every passkey users already saved. One group serves every variant: Electron
// scopes credentials by a per-session metadata secret in userData, so
// stable/alpha never see each other's passkeys anyway.

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
  const keychainAccessGroup = macKeychainAccessGroup()
  if (!keychainAccessGroup) {
    log.info('[webauthn] no keychain access group in this build; Touch ID passkeys stay off')
    return
  }
  app.configureWebAuthn({ touchID: { keychainAccessGroup, promptReason: 'sign in to $1' } })

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

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app, dialog } from 'electron'
import { saveAppSettings } from './app-settings-service'
import { t } from './i18n'
import log from './logger'
import { macBundleIdentifier, variant } from './variant'

/**
 * First launch under the new macOS bundle id, on a machine that ran the old one.
 *
 * userData is keyed by productName, so every session, project and setting is
 * already in place. Two things are keyed by the *signing identity* instead and
 * need a hand:
 *
 * - The `safeStorage` keychain item (`<productName> Safe Storage`). Its ACL
 *   names the old designated requirement, so the first read from the new
 *   bundle makes macOS ask the user. "Always Allow" keeps every saved secret;
 *   this module only makes sure the user hears *why* before the system
 *   prompt appears, since nothing about that prompt mentions the migration.
 * - Notification authorization, which macOS keys by bundle id. The stored
 *   "already primed" marker would otherwise claim a grant that does not
 *   exist, so it is reset and the regular priming flow runs again.
 *
 * Fresh installs (no prior userData) and bridge builds skip all of this.
 */

const MARKER_FILE = 'identity.json'
// Either of these exists once the app has run at all under this productName.
const PRIOR_DATA_MARKERS = ['app-settings.json', 'superone.db']

export interface HandoffInput {
  platform: NodeJS.Platform
  packaged: boolean
  bundleId: string | null
  macAppId: string
  seenBundleId: string | null
  hasPriorData: boolean
}

/** Pure decision, exported for tests. */
export function needsIdentityHandoff(input: HandoffInput): boolean {
  if (input.platform !== 'darwin' || !input.packaged) return false
  if (input.bundleId !== input.macAppId) return false
  if (input.seenBundleId === input.macAppId) return false
  return input.hasPriorData
}

function markerPath(): string {
  return join(app.getPath('userData'), MARKER_FILE)
}

function readSeenBundleId(): string | null {
  try {
    const data = JSON.parse(readFileSync(markerPath(), 'utf8')) as { bundleId?: unknown }
    return typeof data.bundleId === 'string' ? data.bundleId : null
  } catch {
    return null
  }
}

function writeSeenBundleId(bundleId: string): void {
  try {
    writeFileSync(markerPath(), JSON.stringify({ bundleId }, null, 2))
  } catch (err) {
    log.warn('[identity-handoff] could not write marker:', err instanceof Error ? err.message : String(err))
  }
}

/**
 * Call after i18n is ready and before anything touches `safeStorage`.
 * Blocks on a native dialog only when a handoff is actually due.
 */
export async function runIdentityHandoff(): Promise<void> {
  const bundleId = macBundleIdentifier()
  const { macAppId } = variant()
  const userData = app.getPath('userData')
  const due = needsIdentityHandoff({
    platform: process.platform,
    packaged: app.isPackaged,
    bundleId,
    macAppId,
    seenBundleId: readSeenBundleId(),
    hasPriorData: PRIOR_DATA_MARKERS.some((name) => existsSync(join(userData, name))),
  })
  if (!due) {
    // Keep the marker current so a later id change is detected against this one.
    if (bundleId && bundleId === macAppId && readSeenBundleId() !== bundleId) writeSeenBundleId(bundleId)
    return
  }

  log.info(`[identity-handoff] first launch as ${bundleId} over existing data`)
  saveAppSettings({ notificationsPrimedAt: null })
  await dialog.showMessageBox({
    type: 'info',
    message: t('identityHandoff.title'),
    detail: t('identityHandoff.body'),
    buttons: [t('identityHandoff.continue')],
    defaultId: 0,
  })
  writeSeenBundleId(macAppId)
}

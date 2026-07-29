/**
 * Dev lifecycle for SuperOne Dev Computer Use.app
 *
 * - Started when SuperOne dev (electron-vite) becomes ready
 * - Stopped when SuperOne quits
 * - Stable TCC identity: com.superone.computer-use.dev
 *
 * Release helper (com.superone.computer-use) is packaged separately and not
 * managed by this module.
 */

import { existsSync } from 'node:fs'
import log from '../logger'
import {
  DEV_HELPER_APP_NAME,
  DEV_HELPER_BUNDLE_ID,
  defaultHelperSocketPath,
  getSharedHelperClient,
  killHelperProcesses,
  resetSharedHelperClient,
  resolveHelperAppPath,
} from './platform/macos-helper-client'

let started = false

export function isDevComputerUseHelperManaged(): boolean {
  return process.platform === 'darwin' && process.env.SUPERONE_CU_MANAGE_HELPER !== '0'
}

/**
 * Launch SuperOne Dev Computer Use and keep it warm for the SuperOne session.
 * No-op on non-macOS or when the .app is missing (log once).
 */
export async function startDevComputerUseHelper(): Promise<void> {
  if (!isDevComputerUseHelperManaged()) return
  if (started) return

  const appPath = resolveHelperAppPath({ preferDev: true })
  if (!appPath || !existsSync(appPath)) {
    log.warn(
      '[computer-use] Dev helper not found. Build with: bash apps/desktop/native/computer-use-helper/scripts/build.sh dev',
    )
    return
  }

  // Only manage the Dev app name; never kill a production helper if present.
  log.info(
    '[computer-use] starting %s (%s) path=%s socket=%s',
    DEV_HELPER_APP_NAME,
    DEV_HELPER_BUNDLE_ID,
    appPath,
    defaultHelperSocketPath(),
  )

  try {
    const client = getSharedHelperClient()
    // Prefer reconnecting to an already-running helper (same SuperOne session restart).
    const ok = await client.tryConnectOnly(800)
    if (!ok) {
      await client.restartHelper(12_000)
    }
    const doctor = await client.doctor().catch(() => null)
    if (doctor) {
      log.info(
        '[computer-use] helper doctor accessibility=%s screenRecording=%s pid=%s',
        doctor.accessibility,
        doctor.screenRecording,
        String((doctor as { pid?: number }).pid ?? '?'),
      )
      if (doctor.screenRecording !== 'granted' || doctor.accessibility !== 'granted') {
        log.warn(
          '[computer-use] Missing TCC for **%s** — opening OCU-style permission onboarding (drag app into System Settings).',
          DEV_HELPER_APP_NAME,
        )
        // Non-blocking: helper presents native drag-to-Settings UI.
        void client.call('open_permission_onboarding').catch((err) => {
          log.warn(
            '[computer-use] open_permission_onboarding failed: %s',
            err instanceof Error ? err.message : String(err),
          )
        })
      }
    }
    started = true
  } catch (err) {
    log.warn(
      '[computer-use] failed to start dev helper: %s',
      err instanceof Error ? err.message : String(err),
    )
  }
}

/** Open the native permission onboarding window (drag app icon into System Settings). */
export async function openComputerUsePermissionOnboarding(): Promise<{
  presented: boolean
  accessibility?: string
  screenRecording?: string
  reason?: string
  error?: string
}> {
  if (process.platform !== 'darwin') {
    return { presented: false, error: 'Computer Use permission UI is macOS-only' }
  }
  try {
    await startDevComputerUseHelper()
    const client = getSharedHelperClient()
    const result = await client.call<{
      presented: boolean
      accessibility?: string
      screenRecording?: string
      reason?: string
    }>('open_permission_onboarding')
    return result
  } catch (err) {
    return {
      presented: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** Kill SuperOne Dev Computer Use when SuperOne exits. */
export function stopDevComputerUseHelper(): void {
  if (!isDevComputerUseHelperManaged()) return
  log.info('[computer-use] stopping %s', DEV_HELPER_APP_NAME)
  try {
    const client = getSharedHelperClient()
    void client.request('terminate', {}, 800).catch(() => {})
  } catch {
    // ignore
  }
  resetSharedHelperClient()
  killHelperProcesses()
  started = false
}

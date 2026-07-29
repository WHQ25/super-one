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
import type { HelperDoctor } from './platform/helper-protocol'

let started = false

export interface ComputerUsePermissionStatus {
  requested: boolean
  accessibility?: string
  screenRecording?: string
  helperPath?: string
  screenRecordingNeedsRelaunch?: boolean
  reason?: 'already_granted'
  error?: string
}

function statusFromDoctor(
  doctor: HelperDoctor,
  requested: boolean,
): ComputerUsePermissionStatus {
  const alreadyGranted =
    doctor.accessibility === 'granted' && doctor.screenRecording === 'granted'
  return {
    requested,
    accessibility: doctor.accessibility,
    screenRecording: doctor.screenRecording,
    helperPath: doctor.bundlePath,
    screenRecordingNeedsRelaunch: doctor.screenRecordingNeedsRelaunch,
    ...(alreadyGranted ? { reason: 'already_granted' as const } : {}),
  }
}

interface PermissionHelperClient {
  call(method: string): Promise<unknown>
  doctor(): Promise<HelperDoctor>
  restartHelper(): Promise<void>
}

export async function requestMissingComputerUsePermissions(
  client: PermissionHelperClient,
  initialDoctor: HelperDoctor,
): Promise<ComputerUsePermissionStatus> {
  if (
    initialDoctor.accessibility === 'granted'
    && initialDoctor.screenRecording === 'granted'
  ) {
    return statusFromDoctor(initialDoctor, false)
  }

  // Keep the order deterministic so macOS never stacks two TCC prompts.
  await client.call('request_accessibility')
  const screen = await client.call('request_screen_recording') as { screenRecording: string }

  // A newly granted capture permission is only visible to a fresh process.
  if (
    initialDoctor.screenRecording !== 'granted'
    && screen.screenRecording === 'granted'
  ) {
    await client.restartHelper()
  }

  return statusFromDoctor(await client.doctor(), true)
}

export function isDevComputerUseHelperManaged(): boolean {
  return process.platform === 'darwin' && process.env.SUPERONE_CU_MANAGE_HELPER !== '0'
}

/**
 * Launch SuperOne Dev Computer Use and keep it warm for the SuperOne session.
 * No-op on non-macOS or when the .app is missing (log once).
 */
export async function startDevComputerUseHelper(
  options: { requestPermissions?: boolean } = { requestPermissions: false },
): Promise<ComputerUsePermissionStatus | undefined> {
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
          '[computer-use] Missing TCC for **%s**.',
          DEV_HELPER_APP_NAME,
        )
        started = true
        if (options.requestPermissions !== false) {
          log.info(
            '[computer-use] requesting Accessibility then Screen Recording for %s',
            DEV_HELPER_APP_NAME,
          )
          const status = await requestMissingComputerUsePermissions(client, doctor)
          return status
        }
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

/** Read permission state and optionally issue both native macOS requests. */
export async function getComputerUsePermissionStatus(
  requestPermissions = true,
): Promise<ComputerUsePermissionStatus> {
  if (process.platform !== 'darwin') {
    return { requested: false, error: 'Computer Use permissions are macOS-only' }
  }
  try {
    const startupStatus = await startDevComputerUseHelper({ requestPermissions })
    if (startupStatus) return startupStatus

    const client = getSharedHelperClient()
    const doctor = await client.doctor()
    if (!requestPermissions) return statusFromDoctor(doctor, false)
    return requestMissingComputerUsePermissions(client, doctor)
  } catch (err) {
    return {
      requested: false,
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

/** Computer Use helper lifecycle for the active desktop variant. */

import { existsSync } from 'node:fs'
import log from '../logger'
import {
  DEV_HELPER_APP_NAME,
  RELEASE_HELPER_APP_NAME,
  defaultHelperSocketPath,
  getSharedHelperClient,
  killHelperProcesses,
  resetSharedHelperClient,
  resolveHelperAppPath,
  resolveHelperVariant,
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

export function isComputerUseHelperManaged(): boolean {
  return process.platform === 'darwin' && process.env.SUPERONE_CU_MANAGE_HELPER !== '0'
}

/**
 * Launch the matching Computer Use helper and keep it warm for the desktop session.
 * No-op on non-macOS or when the .app is missing (log once).
 */
export async function startComputerUseHelper(
  options: { requestPermissions?: boolean } = { requestPermissions: false },
): Promise<ComputerUsePermissionStatus | undefined> {
  if (!isComputerUseHelperManaged()) return
  if (started) return

  const variant = resolveHelperVariant()
  const appName = variant === 'dev' ? DEV_HELPER_APP_NAME : RELEASE_HELPER_APP_NAME
  const appPath = resolveHelperAppPath({ preferDev: variant === 'dev' })
  if (!appPath || !existsSync(appPath)) {
    log.warn(
      '[computer-use] %s helper not found',
      variant,
    )
    return
  }

  log.info(
    '[computer-use] starting %s (%s) path=%s socket=%s',
    appName,
    variant,
    appPath,
    defaultHelperSocketPath(variant),
  )

  try {
    const client = getSharedHelperClient(variant)
    // Reconnect only when the helper identity matches; set_host transfers ownership
    // to this desktop process after a development server restart.
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
          appName,
        )
        started = true
        if (options.requestPermissions !== false) {
          log.info(
            '[computer-use] requesting Accessibility then Screen Recording for %s',
            appName,
          )
          const status = await requestMissingComputerUsePermissions(client, doctor)
          return status
        }
      }
    }
    started = true
  } catch (err) {
    log.warn(
      '[computer-use] failed to start %s helper: %s',
      resolveHelperVariant(),
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
    const startupStatus = await startComputerUseHelper({ requestPermissions })
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

/** Stop only the helper variant owned by this desktop process. */
export function stopComputerUseHelper(): void {
  if (!isComputerUseHelperManaged()) return
  const variant = resolveHelperVariant()
  const appName = variant === 'dev' ? DEV_HELPER_APP_NAME : RELEASE_HELPER_APP_NAME
  log.info('[computer-use] stopping %s', appName)
  // Do not create or asynchronously reconnect a client during shutdown. The old
  // fire-and-forget terminate request could launch a helper after pkill ran.
  resetSharedHelperClient()
  killHelperProcesses(variant)
  started = false
}

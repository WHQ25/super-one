import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { renderSystemdUserUnit, SYSTEMD_USER_UNIT_NAME, systemdUserUnitPath, type SystemdUnitOptions } from './unit'

export interface InstallResult {
  unitPath: string
  lingerEnabled: boolean | null
  lingerRequired: true
  warnings: string[]
  enabled: boolean
  /** True only when unit is enabled AND linger guarantees logout survival. */
  persistent: boolean
}

export interface LingerStatus {
  enabled: boolean | null
  raw: string
}

/**
 * Check whether systemd user lingering is enabled for the current user.
 * null means loginctl unavailable (non-Linux / no systemd).
 */
export function checkLinger(user?: string): LingerStatus {
  const u = user || process.env.USER || ''
  const result = spawnSync('loginctl', ['show-user', u, '-p', 'Linger', '--value'], {
    encoding: 'utf8',
  })
  if (result.error || result.status !== 0) {
    return { enabled: null, raw: result.stderr || result.error?.message || 'loginctl unavailable' }
  }
  const raw = (result.stdout || '').trim().toLowerCase()
  if (raw === 'yes') return { enabled: true, raw }
  if (raw === 'no') return { enabled: false, raw }
  return { enabled: null, raw }
}

export function writeSystemdUserUnit(opts: SystemdUnitOptions, unitPath = systemdUserUnitPath()): string {
  mkdirSync(dirname(unitPath), { recursive: true })
  writeFileSync(unitPath, renderSystemdUserUnit(opts), { encoding: 'utf8', mode: 0o644 })
  try {
    chmodSync(unitPath, 0o644)
  } catch {
    /* ignore */
  }
  return unitPath
}

/**
 * Install + enable systemd-user unit. Does not force linger enablement;
 * reports clearly when logout will stop the service.
 */
export function installSystemdUserService(opts: SystemdUnitOptions): InstallResult {
  const warnings: string[] = []
  const linger = checkLinger()

  // Fail fast before writing/enabling a unit that cannot survive logout.
  if (linger.enabled !== true) {
    const reason =
      linger.enabled === false
        ? 'systemd user lingering is disabled; enable with `loginctl enable-linger $USER` or install a system service'
        : `could not determine linger state: ${linger.raw}`
    warnings.push(reason)
    return {
      unitPath: systemdUserUnitPath(),
      lingerEnabled: linger.enabled,
      lingerRequired: true,
      warnings,
      enabled: false,
      persistent: false,
    }
  }

  const unitPath = writeSystemdUserUnit(opts)

  const reload = spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' })
  if (reload.status !== 0) {
    warnings.push(`systemctl --user daemon-reload failed: ${reload.stderr || reload.error?.message}`)
  }

  const enable = spawnSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_USER_UNIT_NAME], {
    encoding: 'utf8',
  })
  const enabled = enable.status === 0
  if (!enabled) {
    warnings.push(`systemctl --user enable --now failed: ${enable.stderr || enable.error?.message}`)
  }

  return {
    unitPath,
    lingerEnabled: true,
    lingerRequired: true,
    warnings,
    enabled,
    persistent: enabled,
  }
}

export function uninstallSystemdUserService(removeUnitFile = true): { warnings: string[] } {
  const warnings: string[] = []
  const stop = spawnSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_USER_UNIT_NAME], {
    encoding: 'utf8',
  })
  if (stop.status !== 0) {
    warnings.push(`disable/stop failed: ${stop.stderr || stop.error?.message}`)
  }
  if (removeUnitFile) {
    const path = systemdUserUnitPath()
    if (existsSync(path)) {
      try {
        unlinkSync(path)
      } catch (err) {
        warnings.push(`failed to remove unit file: ${(err as Error).message}`)
      }
    }
    spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' })
  }
  return { warnings }
}

export function systemdUserStatus(): { raw: string; ok: boolean } {
  const result = spawnSync('systemctl', ['--user', 'status', SYSTEMD_USER_UNIT_NAME, '--no-pager'], {
    encoding: 'utf8',
  })
  return {
    raw: (result.stdout || '') + (result.stderr || ''),
    ok: result.status === 0,
  }
}

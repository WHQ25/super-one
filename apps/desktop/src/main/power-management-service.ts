import {
  constants,
  closeSync,
  existsSync,
  fchmodSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app, powerMonitor, powerSaveBlocker } from 'electron'
import type { PowerMode } from '@superone/shared/agent-types'
import log from './logger'

const execFileAsync = promisify(execFile)
const MAC_HELPER_LABEL = 'com.superone.lid-keep-awake'
const MAC_HELPER_DEST = `/Library/PrivilegedHelperTools/${MAC_HELPER_LABEL}`
const MAC_PLIST_DEST = `/Library/LaunchDaemons/${MAC_HELPER_LABEL}.plist`
const HEARTBEAT_INTERVAL_MS = 10_000
const LINUX_POWER_POLL_MS = 5_000

export function resolveLegacyRemotePowerMode(
  currentMode: PowerMode,
  legacyPreventSleep: unknown,
): PowerMode {
  return currentMode === 'system' && legacyPreventSleep === true
    ? 'prevent-idle-sleep'
    : currentMode
}

function unrefTimer(timer: ReturnType<typeof setInterval>): void {
  if (typeof timer === 'object' && 'unref' in timer) timer.unref()
}

export interface LidPowerPlatformAdapter {
  prepare(userInitiated: boolean): Promise<void>
  activate(): Promise<void>
  deactivate(): Promise<void>
  dispose(): Promise<void>
}

export interface PowerManagementServiceDeps {
  platform: NodeJS.Platform
  isOnBatteryPower: () => boolean
  onAc: (handler: () => void) => void
  onBattery: (handler: () => void) => void
  removeOnAc: (handler: () => void) => void
  removeOnBattery: (handler: () => void) => void
  detectLinuxAc: () => boolean
  startPowerBlocker: () => number
  stopPowerBlocker: (id: number) => void
  createAdapter: () => LidPowerPlatformAdapter
  setInterval: typeof globalThis.setInterval
  clearInterval: typeof globalThis.clearInterval
}

/**
 * The closed-lid helper is installed under an admin prompt, so it can only be
 * (re)installed when the user asked for it. A restore at launch therefore fails
 * whenever this build ships a newer helper than the installed one.
 *
 * Named separately so the startup log says "needs approval" rather than looking
 * like a build that is missing its helper resources outright; the user is not
 * told, because the fix is one click in Settings whenever they next want it.
 */
export class PowerHelperApprovalRequiredError extends Error {
  constructor() {
    super('Closed-lid helper needs renewed user approval')
    this.name = 'PowerHelperApprovalRequiredError'
  }
}

export type PowerStartResult =
  | { restored: true }
  | { restored: false; message: string }

export class PowerManagementService {
  private readonly adapter: LidPowerPlatformAdapter
  private mode: PowerMode = 'system'
  private onAcPower = true
  private started = false
  private disposed = false
  private blockerId: number | null = null
  private linuxPowerTimer: ReturnType<typeof setInterval> | null = null
  private transition: Promise<void> = Promise.resolve()

  private readonly handleOnAc = (): void => {
    this.updatePowerSource(true)
  }

  private readonly handleOnBattery = (): void => {
    this.updatePowerSource(false)
  }

  constructor(private readonly deps: PowerManagementServiceDeps) {
    this.adapter = deps.createAdapter()
  }

  async start(mode: PowerMode): Promise<PowerStartResult> {
    if (this.started) return { restored: true }
    this.started = true
    this.onAcPower = this.deps.platform === 'linux'
      ? this.deps.detectLinuxAc()
      : !this.deps.isOnBatteryPower()

    if (this.deps.platform === 'linux') {
      this.linuxPowerTimer = this.deps.setInterval(() => {
        this.updatePowerSource(this.deps.detectLinuxAc())
      }, LINUX_POWER_POLL_MS)
      unrefTimer(this.linuxPowerTimer)
    } else {
      this.deps.onAc(this.handleOnAc)
      this.deps.onBattery(this.handleOnBattery)
    }

    if (mode === 'system') return { restored: true }
    try {
      await this.setMode(mode, false)
      return { restored: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log.warn('[power] could not restore power mode: %s', message)
      return { restored: false, message }
    }
  }

  setMode(mode: PowerMode, userInitiated = true): Promise<void> {
    // A denied permission prompt or transient platform failure must not poison
    // the queue forever; the user needs to be able to retry or turn the mode off.
    this.transition = this.transition.catch(() => {}).then(async () => {
      if (this.disposed) throw new Error('Power management service is disposed')
      if (mode === 'lid-closed-on-ac') {
        await this.adapter.prepare(userInitiated)
      }

      const previous = this.mode
      this.mode = mode
      try {
        await this.reconcile()
      } catch (error) {
        this.mode = previous
        await this.reconcile().catch(() => {})
        throw error
      }
    })
    return this.transition
  }

  private updatePowerSource(onAcPower: boolean): void {
    if (this.onAcPower === onAcPower) return
    this.onAcPower = onAcPower
    log.info('[power] power source changed: %s', onAcPower ? 'ac' : 'battery')
    this.transition = this.transition
      .then(() => this.reconcile())
      .catch((error) => {
        log.warn(
          '[power] power-source transition failed: %s',
          error instanceof Error ? error.message : String(error),
        )
      })
  }

  private async reconcile(): Promise<void> {
    const shouldAllowClosedLid = this.mode === 'lid-closed-on-ac' && this.onAcPower
    if (shouldAllowClosedLid) {
      await this.adapter.activate()
    } else {
      await this.adapter.deactivate()
    }

    const shouldPreventIdleSleep = this.mode !== 'system'
    if (shouldPreventIdleSleep && this.blockerId === null) {
      this.blockerId = this.deps.startPowerBlocker()
      log.info('[power] idle-sleep blocker started id=%d', this.blockerId)
    } else if (!shouldPreventIdleSleep && this.blockerId !== null) {
      this.deps.stopPowerBlocker(this.blockerId)
      log.info('[power] idle-sleep blocker stopped id=%d', this.blockerId)
      this.blockerId = null
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.linuxPowerTimer) {
      this.deps.clearInterval(this.linuxPowerTimer)
      this.linuxPowerTimer = null
    }
    if (this.deps.platform !== 'linux') {
      this.deps.removeOnAc(this.handleOnAc)
      this.deps.removeOnBattery(this.handleOnBattery)
    }

    await this.transition.catch(() => {})
    this.mode = 'system'
    await this.reconcile().catch((error) => {
      log.warn('[power] cleanup failed: %s', error instanceof Error ? error.message : String(error))
    })
    await this.adapter.dispose().catch(() => {})
  }
}

class NoopPlatformAdapter implements LidPowerPlatformAdapter {
  async prepare(): Promise<void> {}
  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {}
}

/**
 * The `SUPERONE_HELPER_VERSION=N` line the helper script carries.
 *
 * Returns null for an unreadable or unversioned script -- including every copy
 * installed before this scheme existed, which must be replaced once.
 */
export function parseMacHelperVersion(contents: string): number | null {
  const match = /^SUPERONE_HELPER_VERSION=(\d+)\s*$/m.exec(contents)
  return match ? Number(match[1]) : null
}

/**
 * Reinstall only when this build ships a NEWER helper than the installed one.
 *
 * The rule used to be byte equality, which was safe but symmetric: the stable
 * and alpha apps ship different bytes for a while after any helper change, so
 * each launch of one invalidated the other and asked for an admin password to
 * put its own copy back. Monotonic versions make an older build accept a newer
 * installed helper -- the daemon is deliberately shared, and a newer revision
 * of it is by definition the one both apps should be running.
 */
export function macHelperIsUpToDate(bundled: number | null, installed: number | null): boolean {
  if (bundled === null || installed === null) return false
  return installed >= bundled
}

function readMacHelperVersion(path: string): number | null {
  try {
    return parseMacHelperVersion(readFileSync(path, 'utf8'))
  } catch {
    return null
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`
}

function resolveMacHelperResources(): { helper: string; plist: string } {
  const root = app.isPackaged
    ? join(process.resourcesPath, 'lid-keep-awake')
    : join(app.getAppPath(), 'resources', 'lid-keep-awake')
  return {
    helper: join(root, 'macos-helper.sh'),
    plist: join(root, `${MAC_HELPER_LABEL}.plist`),
  }
}

async function isMacHelperCurrent(helper: string): Promise<boolean> {
  if (!macHelperIsUpToDate(readMacHelperVersion(helper), readMacHelperVersion(MAC_HELPER_DEST))) {
    return false
  }
  // The plist is covered by the same version, so it is not compared: launchctl
  // failing here is what catches a daemon that was never bootstrapped.
  try {
    await execFileAsync('/bin/launchctl', ['print', `system/${MAC_HELPER_LABEL}`])
    return true
  } catch {
    return false
  }
}

async function installMacHelper(helper: string, plist: string): Promise<void> {
  if (!existsSync(helper) || !existsSync(plist)) {
    throw new Error('Closed-lid helper resources are missing from this build')
  }

  const command = [
    'set -e',
    '/usr/bin/install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools',
    `/usr/bin/install -o root -g wheel -m 755 ${shellQuote(helper)} ${shellQuote(MAC_HELPER_DEST)}`,
    `/usr/bin/install -o root -g wheel -m 644 ${shellQuote(plist)} ${shellQuote(MAC_PLIST_DEST)}`,
    `/bin/launchctl bootout system/${MAC_HELPER_LABEL} >/dev/null 2>&1 || true`,
    `/bin/launchctl bootstrap system ${shellQuote(MAC_PLIST_DEST)}`,
    `/bin/launchctl enable system/${MAC_HELPER_LABEL}`,
    `/bin/launchctl kickstart -k system/${MAC_HELPER_LABEL}`,
  ].join('; ')
  const script = `do shell script ${JSON.stringify(`/bin/sh -c ${shellQuote(command)}`)} with administrator privileges`
  try {
    await execFileAsync('/usr/bin/osascript', ['-e', script], { timeout: 120_000 })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`Administrator approval is required to enable closed-lid operation: ${message}`)
  }

  if (!await isMacHelperCurrent(helper)) {
    throw new Error('The closed-lid helper was installed but could not be started')
  }
}

class MacPlatformAdapter implements LidPowerPlatformAdapter {
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private active = false
  /**
   * One lease per process, not per user. The LaunchDaemon is deliberately
   * shared by every SuperOne variant (two privileged root daemons for one
   * product would be worse), but a shared lease file meant either app turning
   * closed-lid mode off deleted the lease the other was relying on -- and a
   * closed lid then really slept the Mac mid-run.
   */
  private readonly leasePath =
    `/private/tmp/${MAC_HELPER_LABEL}.${process.getuid?.() ?? 0}.${process.pid}.lease`

  async prepare(userInitiated: boolean): Promise<void> {
    const resources = resolveMacHelperResources()
    if (await isMacHelperCurrent(resources.helper)) return
    if (!userInitiated) {
      throw new PowerHelperApprovalRequiredError()
    }
    await installMacHelper(resources.helper, resources.plist)
  }

  async activate(): Promise<void> {
    if (this.active) return
    this.active = true
    this.writeLease()
    this.heartbeatTimer = setInterval(() => this.writeLease(), HEARTBEAT_INTERVAL_MS)
    unrefTimer(this.heartbeatTimer)
    log.info('[lid-power] macOS closed-lid lease started')
  }

  private writeLease(): void {
    const flags = constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC
      | (constants.O_NOFOLLOW ?? 0)
    const fd = openSync(this.leasePath, flags, 0o600)
    try {
      fchmodSync(fd, 0o600)
      writeFileSync(fd, String(Math.floor(Date.now() / 1000)), 'utf8')
    } finally {
      closeSync(fd)
    }
  }

  async deactivate(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (!this.active && !existsSync(this.leasePath)) return
    this.active = false
    rmSync(this.leasePath, { force: true })
    log.info('[lid-power] macOS closed-lid lease stopped')
  }

  async dispose(): Promise<void> {
    await this.deactivate()
  }
}

export function parseWindowsAcLidAction(output: string): number | null {
  const values = [...output.matchAll(/0x([0-9a-f]{8})\s*$/gim)]
    .map((match) => Number.parseInt(match[1], 16))
  return values.length >= 2 && Number.isInteger(values[0]) ? values[0] : null
}

interface WindowsPowerState {
  previousAcAction: number
}

function powershellQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

class WindowsPlatformAdapter implements LidPowerPlatformAdapter {
  private readonly statePath = join(app.getPath('userData'), 'lid-power-state.json')
  private state: WindowsPowerState | null = null
  private watchdog: ChildProcess | null = null

  async prepare(): Promise<void> {
    await execFileAsync('powercfg.exe', ['/GETACTIVESCHEME'])
    if (this.state) return

    // A normal app exit is covered by both dispose() and the detached watchdog.
    // This file is the final recovery path for a machine crash or forced reboot,
    // where both processes can disappear before restoring the user's policy.
    let recovered: WindowsPowerState | null = null
    try {
      const parsed = JSON.parse(readFileSync(this.statePath, 'utf8')) as Partial<WindowsPowerState>
      if (Number.isInteger(parsed.previousAcAction)
        && parsed.previousAcAction! >= 0
        && parsed.previousAcAction! <= 3) {
        recovered = { previousAcAction: parsed.previousAcAction! }
      }
    } catch {
      // No recovery file is the normal case.
    }
    if (!recovered) {
      if (existsSync(this.statePath)) rmSync(this.statePath, { force: true })
      return
    }

    await this.setAcAction(recovered.previousAcAction)
    rmSync(this.statePath, { force: true })
    log.info('[lid-power] recovered stale Windows AC lid action %d', recovered.previousAcAction)
  }

  async activate(): Promise<void> {
    if (this.state) return
    const { stdout } = await execFileAsync('powercfg.exe', [
      '/QUERY', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION',
    ])
    const previousAcAction = parseWindowsAcLidAction(stdout)
    if (previousAcAction === null) {
      throw new Error('Could not read the current Windows lid-close policy')
    }
    if (previousAcAction === 0) return

    this.state = { previousAcAction }
    writeFileSync(this.statePath, JSON.stringify(this.state), { mode: 0o600 })
    try {
      await this.setAcAction(0)
      this.startWatchdog(previousAcAction)
    } catch (error) {
      this.state = null
      rmSync(this.statePath, { force: true })
      throw error
    }
    log.info('[lid-power] Windows AC lid action changed from %d to 0', previousAcAction)
  }

  private async setAcAction(action: number): Promise<void> {
    await execFileAsync('powercfg.exe', [
      '/SETACVALUEINDEX', 'SCHEME_CURRENT', 'SUB_BUTTONS', 'LIDACTION', String(action),
    ])
    await execFileAsync('powercfg.exe', ['/SETACTIVE', 'SCHEME_CURRENT'])
  }

  private startWatchdog(previousAcAction: number): void {
    const script = [
      `$process = Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue`,
      'if ($process) { $process.WaitForExit() }',
      `& powercfg.exe /SETACVALUEINDEX SCHEME_CURRENT SUB_BUTTONS LIDACTION ${previousAcAction}`,
      '& powercfg.exe /SETACTIVE SCHEME_CURRENT',
      `Remove-Item -LiteralPath ${powershellQuote(this.statePath)} -Force -ErrorAction SilentlyContinue`,
    ].join('; ')
    this.watchdog = spawn('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script,
    ], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    this.watchdog.unref()
  }

  async deactivate(): Promise<void> {
    if (!this.state) return
    const previous = this.state.previousAcAction
    await this.setAcAction(previous)
    this.state = null
    rmSync(this.statePath, { force: true })
    this.watchdog?.kill()
    this.watchdog = null
    log.info('[lid-power] Windows AC lid action restored to %d', previous)
  }

  async dispose(): Promise<void> {
    await this.deactivate()
  }
}

function spawnAndConfirm(command: string, args: string[]): Promise<ChildProcess> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' })
    const onError = (error: Error): void => reject(error)
    child.once('error', onError)
    child.once('spawn', () => {
      child.removeListener('error', onError)
      resolve(child)
    })
  })
}

class LinuxPlatformAdapter implements LidPowerPlatformAdapter {
  private inhibitor: ChildProcess | null = null

  async prepare(): Promise<void> {
    await execFileAsync('systemd-inhibit', ['--list', '--no-pager'], { timeout: 5_000 })
  }

  async activate(): Promise<void> {
    if (this.inhibitor) return
    this.inhibitor = await spawnAndConfirm('systemd-inhibit', [
      '--what=sleep:idle:handle-lid-switch',
      '--who=SuperOne',
      '--why=User enabled closed-lid operation on AC power',
      '--mode=block',
      '/bin/sh', '-c', 'while /bin/kill -0 "$1" 2>/dev/null; do /bin/sleep 5; done',
      'superone-lid-watchdog', String(process.pid),
    ])
    this.inhibitor.once('exit', () => {
      this.inhibitor = null
    })
    log.info('[lid-power] Linux sleep/lid inhibitor started')
  }

  async deactivate(): Promise<void> {
    if (!this.inhibitor) return
    this.inhibitor.kill()
    this.inhibitor = null
    log.info('[lid-power] Linux sleep/lid inhibitor stopped')
  }

  async dispose(): Promise<void> {
    await this.deactivate()
  }
}

export function detectLinuxAcPower(): boolean {
  const root = '/sys/class/power_supply'
  let sawExternalSupply = false
  try {
    for (const name of readdirSync(root)) {
      const dir = join(root, name)
      let type = ''
      try {
        type = readFileSync(join(dir, 'type'), 'utf8').trim()
      } catch {
        continue
      }
      if (type === 'Battery') continue
      let online = ''
      try {
        online = readFileSync(join(dir, 'online'), 'utf8').trim()
      } catch {
        continue
      }
      sawExternalSupply = true
      if (online === '1') return true
    }
  } catch {
    // Desktops and non-sysfs platforms have no readable power_supply tree.
    return true
  }
  return !sawExternalSupply
}

function createPlatformAdapter(platform: NodeJS.Platform): LidPowerPlatformAdapter {
  if (platform === 'darwin') return new MacPlatformAdapter()
  if (platform === 'win32') return new WindowsPlatformAdapter()
  if (platform === 'linux') return new LinuxPlatformAdapter()
  return new NoopPlatformAdapter()
}

export function createPowerManagementService(): PowerManagementService {
  return new PowerManagementService({
    platform: process.platform,
    isOnBatteryPower: () => powerMonitor.isOnBatteryPower(),
    onAc: (handler) => powerMonitor.on('on-ac', handler),
    onBattery: (handler) => powerMonitor.on('on-battery', handler),
    removeOnAc: (handler) => powerMonitor.removeListener('on-ac', handler),
    removeOnBattery: (handler) => powerMonitor.removeListener('on-battery', handler),
    detectLinuxAc: detectLinuxAcPower,
    startPowerBlocker: () => powerSaveBlocker.start('prevent-app-suspension'),
    stopPowerBlocker: (id) => { powerSaveBlocker.stop(id) },
    createAdapter: () => createPlatformAdapter(process.platform),
    setInterval,
    clearInterval,
  })
}

import { createConnection, type Socket } from 'node:net'
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { HelperRequest, HelperResponse, HelperEvent } from './helper-protocol'
import { isHelperEvent } from './helper-protocol'
import type { HelperDoctor } from './helper-protocol'
import { variant as appVariant } from '../../variant'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

export const DEV_HELPER_APP_NAME = 'SuperOne Dev Computer Use'
export const DEV_HELPER_BUNDLE_ID = 'com.superone.computer-use.dev'

/**
 * Release helper identity, scoped to the build variant.
 *
 * The helper is installed OUTSIDE the app bundle on purpose (macOS attributes
 * a nested app's Screen Recording grant to the outer app), so the two
 * side-by-side variants would otherwise share one install root, one bundle id
 * and one socket. Each launch fingerprints the bundle and, on a mismatch,
 * pkills by executable name and swaps the bundle underneath -- with shared
 * names that is an endless ping-pong between stable and alpha.
 */
export function releaseHelperAppName(): string {
  return `${appVariant().productName} Computer Use`
}

export function releaseHelperBundleId(): string {
  return appVariant().computerUseBundleId
}

export type ComputerUseHelperVariant = 'dev' | 'release'

export interface ResolveHelperAppPathOptions {
  preferDev?: boolean
  /** Injectable for packaged-source regression tests. null skips packaged lookup. */
  resourcesPath?: string | null
  /** Injectable user-level install root. null skips installed-helper lookup. */
  installRoot?: string | null
}

export interface InstallPackagedHelperOptions {
  resourcesPath?: string | null
  installRoot?: string
  /** Tests can disable process cleanup because no real helper is running. */
  stopRunningHelper?: boolean
}

export interface PackagedHelperInstallation {
  appPath: string
  sourcePath: string
  updated: boolean
}

export function resolveHelperVariant(): ComputerUseHelperVariant {
  const envVariant = process.env.SUPERONE_CU_HELPER_VARIANT
  if (envVariant === 'dev' || envVariant === 'release') return envVariant
  return process.env.ELECTRON_RENDERER_URL != null || process.env.NODE_ENV === 'development'
    ? 'dev'
    : 'release'
}

/** Variant-specific socket under TMPDIR — user-only after helper chmod. */
export function defaultHelperSocketPath(
  helperVariant: ComputerUseHelperVariant = resolveHelperVariant(),
): string {
  // The dev helper is repo-local and already distinct. Release sockets must
  // additionally separate the side-by-side app variants: connectOrLaunch and
  // restartHelper unlink the socket path, so a shared one lets each app tear
  // down the other's listener.
  const scope = helperVariant === 'dev' ? 'dev' : appVariant().downloadPrefix
  return join(tmpdir(), `superone-computer-use-${scope}.sock`)
}

function nativeHelperRootCandidates(): string[] {
  return [
    join(MODULE_DIR, '../../../../native/computer-use-helper'),
    join(process.cwd(), 'native/computer-use-helper'),
    join(process.cwd(), 'apps/desktop/native/computer-use-helper'),
  ]
}

export function defaultReleaseHelperInstallRoot(): string {
  return process.env.SUPERONE_CU_HELPER_INSTALL_ROOT
    ?? join(homedir(), 'Library', 'Application Support', appVariant().dataDirName, 'Computer Use')
}

export function installedReleaseHelperAppPath(
  installRoot = defaultReleaseHelperInstallRoot(),
): string {
  return join(installRoot, `${releaseHelperAppName()}.app`)
}

export function resolvePackagedReleaseHelperSource(
  resourcesPath: string | null = typeof process.resourcesPath === 'string'
    ? process.resourcesPath
    : null,
): string | null {
  if (!resourcesPath) return null
  const source = join(
    resourcesPath,
    '..',
    'Frameworks',
    `${releaseHelperAppName()}.app`,
  )
  return existsSync(source) ? source : null
}

function helperBundleFingerprint(appPath: string): string | null {
  const files = [
    join(appPath, 'Contents', 'MacOS', releaseHelperAppName()),
    join(appPath, 'Contents', 'Info.plist'),
    join(appPath, 'Contents', '_CodeSignature', 'CodeResources'),
  ]
  if (files.some((file) => !existsSync(file))) return null
  const hash = createHash('sha256')
  for (const file of files) hash.update(readFileSync(file))
  return hash.digest('hex')
}

/**
 * Copy the signed release helper out of SuperOne.app before launching it.
 * macOS attributes nested apps under Contents/Frameworks to the outer app for
 * Screen Recording, even when the nested bundle has its own identifier.
 */
export function installPackagedReleaseHelper(
  options: InstallPackagedHelperOptions = {},
): PackagedHelperInstallation | null {
  const sourcePath = resolvePackagedReleaseHelperSource(
    options.resourcesPath === undefined
      ? (typeof process.resourcesPath === 'string' ? process.resourcesPath : null)
      : options.resourcesPath,
  )
  if (!sourcePath) return null

  const installRoot = options.installRoot ?? defaultReleaseHelperInstallRoot()
  const appPath = installedReleaseHelperAppPath(installRoot)
  const sourceFingerprint = helperBundleFingerprint(sourcePath)
  if (!sourceFingerprint) {
    throw new Error(`Packaged Computer Use helper is incomplete: ${sourcePath}`)
  }
  if (helperBundleFingerprint(appPath) === sourceFingerprint) {
    return { appPath, sourcePath, updated: false }
  }

  mkdirSync(installRoot, { recursive: true, mode: 0o700 })
  const suffix = `${process.pid}-${Date.now()}`
  const stagingPath = `${appPath}.installing-${suffix}`
  const backupPath = `${appPath}.previous-${suffix}`
  rmSync(stagingPath, { recursive: true, force: true })
  rmSync(backupPath, { recursive: true, force: true })

  try {
    cpSync(sourcePath, stagingPath, { recursive: true, preserveTimestamps: true })
    if (helperBundleFingerprint(stagingPath) !== sourceFingerprint) {
      throw new Error('Copied Computer Use helper failed integrity verification')
    }

    if (options.stopRunningHelper !== false) {
      resetSharedHelperClient()
      killHelperProcesses('release')
    }
    if (existsSync(appPath)) renameSync(appPath, backupPath)
    try {
      renameSync(stagingPath, appPath)
    } catch (err) {
      if (existsSync(backupPath) && !existsSync(appPath)) renameSync(backupPath, appPath)
      throw err
    }
    rmSync(backupPath, { recursive: true, force: true })
    return { appPath, sourcePath, updated: true }
  } finally {
    rmSync(stagingPath, { recursive: true, force: true })
  }
}

/**
 * Resolve helper .app path.
 * - SUPERONE_CU_HELPER_APP overrides everything
 * - packaged release builds may launch only the user-level installed copy
 * - development builds resolve their repo-local app directly
 */
export function resolveHelperAppPath(opts?: ResolveHelperAppPathOptions): string | null {
  if (process.env.SUPERONE_CU_HELPER_APP) {
    return process.env.SUPERONE_CU_HELPER_APP
  }

  const preferDev = opts?.preferDev ?? resolveHelperVariant() === 'dev'
  const names = preferDev
    ? [DEV_HELPER_APP_NAME, releaseHelperAppName()]
    : [releaseHelperAppName(), DEV_HELPER_APP_NAME]

  if (!preferDev) {
    const installRoot = opts?.installRoot === undefined
      ? defaultReleaseHelperInstallRoot()
      : opts.installRoot
    if (installRoot) {
      const installedPath = installedReleaseHelperAppPath(installRoot)
      if (existsSync(installedPath)) return installedPath
    }

    const resourcesPath = opts?.resourcesPath === undefined
      ? (typeof process.resourcesPath === 'string' ? process.resourcesPath : null)
      : opts.resourcesPath
    // A packaged helper is only an installation source. Never fall through to
    // it (or another repo-local variant) when the installed copy is missing.
    if (resolvePackagedReleaseHelperSource(resourcesPath)) return null
  }

  for (const root of nativeHelperRootCandidates()) {
    for (const name of names) {
      const p = join(root, 'dist', `${name}.app`)
      if (existsSync(p)) return p
    }
  }
  return null
}

export function helperProcessMatchPatterns(
  variant?: ComputerUseHelperVariant,
): string[] {
  const dev = `${DEV_HELPER_APP_NAME}.app/Contents/MacOS/${DEV_HELPER_APP_NAME}`
  const release = `${releaseHelperAppName()}.app/Contents/MacOS/${releaseHelperAppName()}`
  if (variant === 'dev') return [dev]
  if (variant === 'release') return [release]
  return [dev, release]
}

export class MacosHelperClient {
  private socket: Socket | null = null
  private buffer = ''
  private pending = new Map<
    string,
    { resolve: (r: HelperResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >()
  private seq = 0
  private connecting: Promise<void> | null = null
  private didRelaunchForScreen = false
  private eventListeners = new Set<(event: HelperEvent) => void>()

  constructor(
    private readonly socketPath: string = defaultHelperSocketPath(),
    private readonly appPath: string | null = resolveHelperAppPath(),
    private readonly variant: ComputerUseHelperVariant = resolveHelperVariant(),
  ) {}

  get path(): string {
    return this.socketPath
  }

  getAppPath(): string | null {
    return this.appPath
  }

  async ensureConnected(timeoutMs = 10_000): Promise<void> {
    if (this.socket && !this.socket.destroyed) return
    if (this.connecting) return this.connecting
    this.connecting = this.connectOrLaunch(timeoutMs).finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  async request(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = 30_000,
  ): Promise<HelperResponse> {
    await this.ensureConnected()
    const id = `r${++this.seq}`
    const req: HelperRequest = { id, method, params }
    return new Promise<HelperResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`helper timeout: ${method}`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      const line = `${JSON.stringify(req)}\n`
      this.socket!.write(line, (err) => {
        if (err) {
          clearTimeout(timer)
          this.pending.delete(id)
          reject(err)
        }
      })
    })
  }

  async call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await this.request(method, params ?? {})
    if (!res.ok) {
      const err = new Error(res.error?.message ?? 'helper error') as Error & { code?: string }
      err.code = res.error?.code
      if (err.code === 'SCREEN_MISSING' && !this.didRelaunchForScreen) {
        this.didRelaunchForScreen = true
        await this.restartHelper()
        const retry = await this.request(method, params ?? {})
        if (!retry.ok) {
          const err2 = new Error(retry.error?.message ?? 'helper error') as Error & { code?: string }
          err2.code = retry.error?.code
          throw err2
        }
        return retry.result as T
      }
      throw err
    }
    return res.result as T
  }

  async doctor(): Promise<HelperDoctor> {
    return this.call<HelperDoctor>('doctor')
  }

  async restartHelper(timeoutMs = 12_000): Promise<void> {
    try {
      await this.request('terminate', {}, 1_500).catch(() => {})
    } catch {
      // ignore
    }
    this.close()
    killHelperProcesses(this.variant)
    await sleep(400)
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
    } catch {
      // ignore
    }
    this.launchHelper()
    const deadline = Date.now() + timeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        await this.connectOnce(500)
        await this.validateConnectedHelper()
        return
      } catch (e) {
        lastErr = e
        await sleep(100)
      }
    }
    throw new Error(`Timed out restarting Computer Use helper: ${String(lastErr)}`)
  }

  close(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(new Error('helper closed'))
    }
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
  }

  /** Soft start without killing existing (used when host lifecycle already started helper). */
  async tryConnectOnly(timeoutMs = 2_000): Promise<boolean> {
    try {
      await this.connectOnce(timeoutMs)
      await this.validateConnectedHelper()
      return true
    } catch {
      this.close()
      return false
    }
  }

  private async connectOrLaunch(timeoutMs: number): Promise<void> {
    let connectError: unknown
    try {
      await this.connectOnce(800)
      await this.validateConnectedHelper()
      return
    } catch (err) {
      connectError = err
      this.close()
    }
    if (!this.appPath) {
      if (connectError instanceof Error && connectError.message.includes('identity mismatch')) {
        throw connectError
      }
      throw new Error(
        'Computer Use helper .app not found. Run: bash apps/desktop/native/computer-use-helper/scripts/build.sh dev',
      )
    }
    killHelperProcesses(this.variant)
    await sleep(200)
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath)
    } catch {
      // ignore
    }
    this.launchHelper()

    const deadline = Date.now() + timeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
      try {
        await this.connectOnce(500)
        await this.validateConnectedHelper()
        return
      } catch (e) {
        lastErr = e
        await sleep(80)
      }
    }
    throw new Error(`Timed out waiting for Computer Use helper: ${String(lastErr)}`)
  }

  private launchHelper(): void {
    if (!this.appPath) return
    spawn('open', [
      '-g',
      '-a',
      this.appPath,
      '--args',
      '--socket',
      this.socketPath,
      '--parent-pid',
      String(process.pid),
    ], {
      detached: true,
      stdio: 'ignore',
    }).unref()
  }

  private async validateConnectedHelper(): Promise<void> {
    const doctorResponse = await this.request('doctor', {}, 2_000)
    if (!doctorResponse.ok) {
      throw new Error(doctorResponse.error?.message ?? 'Computer Use helper doctor failed')
    }
    const doctor = doctorResponse.result as HelperDoctor
    const expectedBundleId = this.variant === 'dev'
      ? DEV_HELPER_BUNDLE_ID
      : releaseHelperBundleId()
    if (doctor.bundleId !== expectedBundleId) {
      throw new Error(
        `Computer Use helper identity mismatch: expected ${expectedBundleId}, got ${doctor.bundleId || 'unknown'}`,
      )
    }

    const hostResponse = await this.request('set_host', { pid: process.pid }, 2_000)
    if (!hostResponse.ok) {
      throw new Error(hostResponse.error?.message ?? 'Computer Use helper host registration failed')
    }
  }

  private connectOnce(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const sock = createConnection(this.socketPath)
      const timer = setTimeout(() => {
        sock.destroy()
        reject(new Error('connect timeout'))
      }, timeoutMs)
      sock.once('connect', () => {
        clearTimeout(timer)
        this.socket = sock
        this.buffer = ''
        sock.setEncoding('utf8')
        sock.on('data', (chunk: string) => this.onData(chunk))
        sock.on('close', () => {
          this.socket = null
        })
        sock.on('error', () => {
          this.socket = null
        })
        resolve()
      })
      sock.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }

  /** Subscribe to helper-initiated events. Returns an unsubscribe function. */
  onEvent(listener: (event: HelperEvent) => void): () => void {
    this.eventListeners.add(listener)
    return () => {
      this.eventListeners.delete(listener)
    }
  }

  private dispatchEvent(event: HelperEvent): void {
    for (const listener of this.eventListeners) {
      // One bad listener must not stop the others, and must not kill the socket read loop.
      try {
        listener(event)
      } catch {
        // ignore listener failure
      }
    }
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (!line.trim()) continue
      try {
        const parsed: unknown = JSON.parse(line)
        // Helper-initiated push (no `id`) rather than a reply to one of our calls.
        if (isHelperEvent(parsed)) {
          this.dispatchEvent(parsed)
          continue
        }
        const res = parsed as HelperResponse
        const pending = this.pending.get(res.id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(res.id)
          pending.resolve(res)
        }
      } catch {
        // ignore malformed
      }
    }
  }
}

export function killHelperProcesses(variant?: ComputerUseHelperVariant): void {
  for (const pattern of helperProcessMatchPatterns(variant)) {
    try {
      execFileSync('pkill', ['-f', pattern], { stdio: 'ignore' })
    } catch {
      // no match
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

let shared: MacosHelperClient | null = null
let sharedVariant: ComputerUseHelperVariant | null = null

export function getSharedHelperClient(
  variant: ComputerUseHelperVariant = resolveHelperVariant(),
): MacosHelperClient {
  if (!shared || sharedVariant !== variant) {
    shared?.close()
    shared = new MacosHelperClient(
      defaultHelperSocketPath(variant),
      resolveHelperAppPath({ preferDev: variant === 'dev' }),
      variant,
    )
    sharedVariant = variant
  }
  return shared
}

export function resetSharedHelperClient(): void {
  shared?.close()
  shared = null
  sharedVariant = null
}

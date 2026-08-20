import { execFile } from 'node:child_process'
import type {
  IosSimulatorCreateRequest,
  IosSimulatorDevice,
  IosSimulatorDeviceTypeOption,
  IosSimulatorRuntimeOption,
  IosSimulatorStatus,
} from '@superone/shared/ios-simulator'

export interface SimctlCommandRunner {
  /** `input` is written to the child's stdin, which is how `simctl pbcopy` is fed. */
  runText(args: string[], input?: string): Promise<string>
}

function execFileText(file: string, args: string[], input?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file, args, {
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
        // simctl decodes anything it reads on stdin using the process locale, and
        // falls back to Mac Roman when there is none. Electron's children inherit
        // whatever the launching shell exported, which under Finder is nothing at
        // all, so `pbcopy` silently turned every UTF-8 byte of Chinese into its Mac
        // Roman lookalike -- 你好 arrived as `‰Ω†Â·Ω`. Measured both ways against a
        // booted device: identical bytes round-trip perfectly once this is set.
        ...(input === undefined ? {} : { env: { ...process.env, LC_ALL: 'en_US.UTF-8' } }),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error((stderr || error.message).trim()))
          return
        }
        resolve(stdout)
      },
    )
    // Closing stdin matters even with nothing to say: pbcopy reads until EOF.
    if (input !== undefined) child.stdin?.end(input, 'utf8')
  })
}

const defaultRunner: SimctlCommandRunner = {
  runText: (args, input) => execFileText('/usr/bin/xcrun', args, input),
}

interface RawSimctlDevice {
  udid?: unknown
  name?: unknown
  deviceTypeIdentifier?: unknown
  state?: unknown
  isAvailable?: unknown
  availabilityError?: unknown
}

function runtimeDisplayName(identifier: string): string {
  const suffix = identifier.split('.').pop() ?? identifier
  return suffix
    .replace(/^SimRuntime\./, '')
    // xrOS is the identifier Apple ships; visionOS is what the product is called.
    .replace(/^xrOS-/, 'visionOS-')
    .replace(/-/g, ' ')
    // Every platform, not just iOS: the launcher shows these version numbers verbatim.
    .replace(/^([A-Za-z]+) (\d+) (\d+)$/, '$1 $2.$3')
}

export function parseSimctlDevices(raw: string): IosSimulatorDevice[] {
  const parsed = JSON.parse(raw) as { devices?: Record<string, RawSimctlDevice[]> }
  const rows: IosSimulatorDevice[] = []
  for (const [runtimeIdentifier, devices] of Object.entries(parsed.devices ?? {})) {
    if (!Array.isArray(devices)) continue
    for (const entry of devices) {
      if (typeof entry.udid !== 'string' || typeof entry.name !== 'string') continue
      const state = typeof entry.state === 'string' ? entry.state : 'Unknown'
      const available = entry.isAvailable !== false
      rows.push({
        udid: entry.udid,
        name: entry.name,
        runtimeIdentifier,
        runtimeName: runtimeDisplayName(runtimeIdentifier),
        state,
        booted: state === 'Booted',
        available,
        ...(typeof entry.deviceTypeIdentifier === 'string'
          ? { deviceTypeIdentifier: entry.deviceTypeIdentifier }
          : {}),
        ...(typeof entry.availabilityError === 'string'
          ? { availabilityError: entry.availabilityError }
          : {}),
        ownedBySuperOne: false,
      })
    }
  }
  return rows.sort((a, b) => {
    if (a.booted !== b.booted) return a.booted ? -1 : 1
    const runtime = b.runtimeName.localeCompare(a.runtimeName, undefined, { numeric: true })
    return runtime || a.name.localeCompare(b.name)
  })
}

interface RawSimctlRuntime {
  identifier?: unknown
  version?: unknown
  isAvailable?: unknown
  supportedDeviceTypes?: unknown
}

function parseDeviceTypes(raw: unknown): IosSimulatorDeviceTypeOption[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry: Record<string, unknown>) =>
    typeof entry?.identifier === 'string' && typeof entry.name === 'string'
      ? [{
        identifier: entry.identifier,
        name: entry.name,
        productFamily: typeof entry.productFamily === 'string' ? entry.productFamily : 'Other',
      }]
      : [])
}

export function parseSimctlRuntimes(raw: string): IosSimulatorRuntimeOption[] {
  const parsed = JSON.parse(raw) as { runtimes?: RawSimctlRuntime[] }
  const byIdentifier = new Map<string, IosSimulatorRuntimeOption>()
  for (const entry of parsed.runtimes ?? []) {
    if (typeof entry.identifier !== 'string' || entry.isAvailable === false) continue
    // Two Xcode installs can advertise the same runtime; the first wins.
    if (byIdentifier.has(entry.identifier)) continue
    byIdentifier.set(entry.identifier, {
      identifier: entry.identifier,
      name: runtimeDisplayName(entry.identifier),
      version: typeof entry.version === 'string' ? entry.version : '',
      deviceTypes: parseDeviceTypes(entry.supportedDeviceTypes),
    })
  }
  return [...byIdentifier.values()]
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))
}

async function readDeveloperStatus(): Promise<Omit<IosSimulatorStatus, 'helper' | 'previewMode'>> {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      platform: process.platform,
      developerDirectory: null,
      xcodeVersion: null,
      xcodeBuild: null,
      simctlPath: null,
      error: 'iOS Simulator is available only on macOS.',
    }
  }
  try {
    const [developerDirectory, version, simctlPath] = await Promise.all([
      execFileText('/usr/bin/xcode-select', ['-p']),
      execFileText('/usr/bin/xcodebuild', ['-version']),
      execFileText('/usr/bin/xcrun', ['--find', 'simctl']),
    ])
    const lines = version.trim().split(/\r?\n/)
    const isFullXcode = developerDirectory.includes('.app/Contents/Developer')
    return {
      supported: isFullXcode,
      platform: process.platform,
      developerDirectory: developerDirectory.trim(),
      xcodeVersion: lines[0] ?? null,
      xcodeBuild: lines.find((line) => line.startsWith('Build version '))?.slice('Build version '.length) ?? null,
      simctlPath: simctlPath.trim(),
      ...(!isFullXcode
        ? { error: 'xcode-select must point to a full Xcode installation, not CommandLineTools.' }
        : {}),
    }
  } catch (error) {
    return {
      supported: false,
      platform: process.platform,
      developerDirectory: null,
      xcodeVersion: null,
      xcodeBuild: null,
      simctlPath: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export class SimctlClient {
  constructor(private readonly runner: SimctlCommandRunner = defaultRunner) {}

  async status(): Promise<Omit<IosSimulatorStatus, 'helper' | 'previewMode'>> {
    return readDeveloperStatus()
  }

  async listDevices(): Promise<IosSimulatorDevice[]> {
    return parseSimctlDevices(await this.runner.runText(['simctl', 'list', 'devices', '--json']))
  }

  /** Maps a device type identifier to the bundle that holds its artwork. */
  async listDeviceTypeBundles(): Promise<Map<string, string>> {
    const raw = await this.runner.runText(['simctl', 'list', 'devicetypes', '--json'])
    const parsed = JSON.parse(raw) as { devicetypes?: { identifier?: unknown; bundlePath?: unknown }[] }
    const bundles = new Map<string, string>()
    for (const entry of parsed.devicetypes ?? []) {
      if (typeof entry.identifier === 'string' && typeof entry.bundlePath === 'string') {
        bundles.set(entry.identifier, entry.bundlePath)
      }
    }
    return bundles
  }

  /**
   * Puts text on the device's own pasteboard. This is the only way arbitrary Unicode
   * reaches a simulator: its keyboard channel speaks HID usage codes, which cannot
   * express Chinese or emoji any more than a physical keyboard can.
   */
  async writePasteboard(udid: string, text: string): Promise<void> {
    await this.runner.runText(['simctl', 'pbcopy', udid], text)
  }

  async listRuntimes(): Promise<IosSimulatorRuntimeOption[]> {
    return parseSimctlRuntimes(await this.runner.runText(['simctl', 'list', 'runtimes', '--json']))
  }

  async create(request: IosSimulatorCreateRequest): Promise<string> {
    const name = request.name.trim()
    if (!name) throw new Error('A simulator name is required.')
    const udid = await this.runner.runText([
      'simctl', 'create', name, request.deviceTypeIdentifier, request.runtimeIdentifier,
    ])
    return udid.trim()
  }

  async boot(udid: string): Promise<void> {
    const current = (await this.listDevices()).find((device) => device.udid === udid)
    if (!current) throw new Error(`Simulator ${udid} was not found.`)
    if (!current.available) throw new Error(current.availabilityError ?? `Simulator ${udid} is unavailable.`)
    if (current.booted) return
    await this.runner.runText(['simctl', 'boot', udid])
    await this.runner.runText(['simctl', 'bootstatus', udid, '-b'])
  }

  async shutdown(udid: string): Promise<void> {
    const current = (await this.listDevices()).find((device) => device.udid === udid)
    if (!current?.booted) return
    await this.runner.runText(['simctl', 'shutdown', udid])
  }
}


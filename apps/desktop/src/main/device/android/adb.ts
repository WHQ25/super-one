/**
 * Talking to `adb`, which is the whole reason Android needs no separate path for
 * emulators and phones.
 *
 * `adb devices` reports an AVD (`emulator-5554`) and a cable-attached phone
 * (`39061FDJH00BQZ`) through the same interface, and every command below works the
 * same on both. Nothing above this file distinguishes them — a real device is what
 * falls out of supporting the emulator, not a second implementation.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'

/** Result of one `adb` invocation. `stdout` stays binary — `exec-out` returns PNGs. */
export interface AdbResult {
  stdout: Buffer
  stderr: string
  code: number
}

/**
 * How a command is actually run.
 *
 * Injected rather than reached for directly so the parsing below — which is where the
 * bugs live — can be tested against real `adb` output without a subprocess.
 */
export type RunAdb = (
  args: readonly string[],
  options?: { timeoutMs?: number; signal?: AbortSignal },
) => Promise<AdbResult>

export class AdbError extends Error {
  constructor(message: string, readonly code: number, readonly stderr: string) {
    super(message)
    this.name = 'AdbError'
  }
}

/**
 * Where the SDK is, in the order the tools themselves look.
 *
 * The default path is listed last but is not a fallback in the usual sense: neither
 * environment variable is set on a stock Android Studio install, so for most machines
 * it IS the answer. Treating it as a desperate last resort would have this reporting
 * "no SDK" on the common case.
 */
export function androidSdkRoot(env: NodeJS.ProcessEnv = process.env): string | null {
  const candidates = [
    env.ANDROID_HOME,
    env.ANDROID_SDK_ROOT,
    defaultSdkPath(env),
  ]
  return candidates.find((path): path is string => Boolean(path) && existsSync(path!)) ?? null
}

function defaultSdkPath(env: NodeJS.ProcessEnv): string | null {
  switch (platform()) {
    case 'darwin': return join(homedir(), 'Library', 'Android', 'sdk')
    case 'win32': return env.LOCALAPPDATA ? join(env.LOCALAPPDATA, 'Android', 'Sdk') : null
    default: return join(homedir(), 'Android', 'Sdk')
  }
}

function toolPath(sdk: string, ...segments: string[]): string | null {
  const suffix = platform() === 'win32' ? '.exe' : ''
  const path = join(sdk, ...segments.slice(0, -1), `${segments.at(-1)}${suffix}`)
  return existsSync(path) ? path : null
}

export function adbPath(env?: NodeJS.ProcessEnv): string | null {
  const sdk = androidSdkRoot(env)
  return sdk ? toolPath(sdk, 'platform-tools', 'adb') : null
}

export function emulatorPath(env?: NodeJS.ProcessEnv): string | null {
  const sdk = androidSdkRoot(env)
  return sdk ? toolPath(sdk, 'emulator', 'emulator') : null
}

/**
 * Spawn a command-line tool and capture it whole.
 *
 * Shared with the emulator launcher rather than written twice: both need binary-safe
 * stdout, a timeout, and cancellation, and `emulator` is the one that most needs the
 * stderr kept separate — it writes crash-database warnings there on every run.
 */
export function spawnTool(binary: string, label = 'adb'): RunAdb {
  return (args, options = {}) => new Promise<AdbResult>((resolve, reject) => {
    const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    const stdout: Buffer[] = []
    let stderr = ''
    let settled = false

    const timer = options.timeoutMs
      ? setTimeout(() => {
          settled = true
          child.kill('SIGKILL')
          reject(new AdbError(`${label} ${args[0] ?? ''} timed out after ${options.timeoutMs}ms.`, -1, stderr))
        }, options.timeoutMs)
      : null

    const onAbort = () => {
      settled = true
      child.kill('SIGKILL')
      reject(new AdbError(`${label} ${args[0] ?? ''} was cancelled.`, -1, stderr))
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(error)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve({ stdout: Buffer.concat(stdout), stderr, code: code ?? -1 })
    })
  })
}

/**
 * How `adb` describes a device it can see.
 *
 * `state` matters as much as the serial: a phone with USB debugging not yet approved
 * shows up as `unauthorized`, and offering it as a device the agent can drive would
 * produce a grant the user approves and a connection that then refuses everything.
 */
export interface AdbDevice {
  serial: string
  state: 'device' | 'offline' | 'unauthorized' | 'authorizing' | 'connecting' | 'unknown'
  /** Long-format fields: `product`, `model`, `device`, `transport_id`. */
  properties: Record<string, string>
}

const KNOWN_STATES = new Set<AdbDevice['state']>([
  'device', 'offline', 'unauthorized', 'authorizing', 'connecting',
])

/**
 * Parse `adb devices -l`.
 *
 * Skips the `List of devices attached` header and the `* daemon ... *` chatter adb
 * prints on stdout the first time it has to start its own server — which is not an
 * error and not a device, but is indistinguishable from one to anything that just
 * splits lines.
 */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  const devices: AdbDevice[] = []
  for (const raw of stdout.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('List of devices') || line.startsWith('*')) continue
    const [serial, state, ...rest] = line.split(/\s+/)
    if (!serial || !state) continue
    const properties: Record<string, string> = {}
    for (const field of rest) {
      const separator = field.indexOf(':')
      if (separator > 0) properties[field.slice(0, separator)] = field.slice(separator + 1)
    }
    devices.push({
      serial,
      state: KNOWN_STATES.has(state as AdbDevice['state']) ? state as AdbDevice['state'] : 'unknown',
      properties,
    })
  }
  return devices
}

export class Adb {
  constructor(private readonly run: RunAdb) {}

  /** Everything adb can see, emulators and cable-attached phones alike. */
  async devices(signal?: AbortSignal): Promise<AdbDevice[]> {
    const result = await this.run(['devices', '-l'], { timeoutMs: 10_000, ...(signal ? { signal } : {}) })
    if (result.code !== 0) {
      throw new AdbError('adb devices failed.', result.code, result.stderr)
    }
    return parseAdbDevices(result.stdout.toString('utf8'))
  }

  /**
   * Run a shell command and read its output as text.
   *
   * Arguments are passed as a list, never joined into one string: a device shell
   * applies its own word splitting, so a path with a space in it silently becomes two
   * arguments the moment anyone concatenates.
   */
  async shell(serial: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
    const result = await this.raw(serial, ['shell', ...args], signal)
    return result.toString('utf8')
  }

  /**
   * Run a shell command and read its output as bytes.
   *
   * `exec-out` rather than `shell` because the shell transport mangles binary — it
   * translates LF to CRLF, which corrupts every PNG that goes through it.
   */
  async execOut(serial: string, args: readonly string[], signal?: AbortSignal): Promise<Buffer> {
    return this.raw(serial, ['exec-out', ...args], signal, 30_000)
  }

  async getProp(serial: string, name: string, signal?: AbortSignal): Promise<string> {
    return (await this.shell(serial, ['getprop', name], signal)).trim()
  }

  /**
   * Send a command to an emulator's own console.
   *
   * Not a shell command — it goes to the emulator PROCESS rather than to Android, and
   * that is what makes it the only way to ask a running emulator which AVD it is.
   * Replies are terminated by a bare `OK`; see `parseEmuResponse`. Failing outright on
   * a physical device is a useful signal rather than a problem.
   */
  async emu(serial: string, args: readonly string[], signal?: AbortSignal): Promise<string> {
    return (await this.raw(serial, ['emu', ...args], signal)).toString('utf8')
  }

  /** Bridge a host TCP port to a device-side socket. Returns the local port. */
  async forward(serial: string, remote: string, signal?: AbortSignal): Promise<number> {
    // `tcp:0` asks adb to pick a free port and print it, which avoids both racing
    // another process for a fixed number and having to probe for one ourselves.
    const output = await this.raw(serial, ['forward', 'tcp:0', remote], signal)
    const port = Number.parseInt(output.toString('utf8').trim(), 10)
    if (!Number.isInteger(port) || port <= 0) {
      throw new AdbError(`adb forward returned no port for ${remote}.`, 0, output.toString('utf8'))
    }
    return port
  }

  async removeForward(serial: string, localPort: number): Promise<void> {
    await this.raw(serial, ['forward', '--remove', `tcp:${localPort}`]).catch(() => undefined)
  }

  async push(serial: string, local: string, remote: string, signal?: AbortSignal): Promise<void> {
    await this.raw(serial, ['push', local, remote], signal, 60_000)
  }

  /** Copy a device-side capture to the host without passing it through a shell. */
  async pull(serial: string, remote: string, local: string, signal?: AbortSignal): Promise<void> {
    await this.raw(serial, ['pull', remote, local], signal, 60_000)
  }

  /** Block until the device answers at all. Says nothing about whether it has booted. */
  async waitForDevice(serial: string, signal?: AbortSignal): Promise<void> {
    await this.raw(serial, ['wait-for-device'], signal, 120_000)
  }

  private async raw(
    serial: string,
    args: readonly string[],
    signal?: AbortSignal,
    timeoutMs = 15_000,
  ): Promise<Buffer> {
    const result = await this.run(['-s', serial, ...args], {
      timeoutMs,
      ...(signal ? { signal } : {}),
    })
    if (result.code !== 0) {
      throw new AdbError(
        `adb ${args[0]} failed on ${serial}: ${result.stderr.trim() || `exit ${result.code}`}`,
        result.code,
        result.stderr,
      )
    }
    return result.stdout
  }
}

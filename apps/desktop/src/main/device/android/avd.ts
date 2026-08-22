/**
 * Android Virtual Devices — the software emulators, which are the point of this whole
 * platform integration. A cable-attached phone needs none of this file.
 *
 * An AVD exists in two places and you need both. `emulator -list-avds` names the ones
 * installed, and `~/.android/avd/<id>.avd/config.ini` carries everything worth showing
 * about one: its display name, its device profile, its screen. Neither alone is enough
 * — the list has no metadata, and the config directory can hold stale entries for AVDs
 * the emulator no longer offers.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { androidVersionName, parseApiLevel } from './android-version'
import type { RunAdb } from './adb'

export interface AvdSummary {
  /** `Medium_Phone_API_36.1` — what `emulator -avd` takes and what `emu avd name` returns. */
  id: string
  /** `Medium Phone API 36.1` — what the user named it, falling back to the id. */
  displayName: string
  /** `medium_phone` — the hardware profile it was created from. Drives family. */
  deviceProfile: string
  apiLevel: number
  /** "Android 16". */
  platformVersion: string
  screen?: { width: number; height: number }
}

/** Where AVD definitions live. */
export function avdHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.ANDROID_AVD_HOME ?? join(homedir(), '.android', 'avd')
}

/**
 * Names from `emulator -list-avds`.
 *
 * Reads stdout ONLY. The emulator binary writes crash-database warnings to stderr on
 * every single run — on this machine, `mkdir /tmp/android-<user>/emu-crash-*.db: No
 * such file or directory` — and a reader that merges the two streams turns that into
 * a phantom AVD named `[86068:10080979:...]`.
 */
export function parseAvdList(stdout: string): string[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('['))
}

/** `key=value` lines. Android's own config format — no sections, no quoting. */
export function parseIni(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    out[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return out
}

/**
 * Build a summary from the two files that describe one AVD.
 *
 * `target` comes from the outer `.ini`, everything else from the inner `config.ini`.
 * The API level is read from the target first and the system image path second: they
 * agree in practice, but the target is the one the emulator itself honours.
 */
export function parseAvdConfig(
  id: string,
  outerIni: string,
  configIni: string,
): AvdSummary {
  const outer = parseIni(outerIni)
  const config = parseIni(configIni)
  const apiLevel = parseApiLevel(outer.target ?? '')
    || parseApiLevel(config['image.sysdir.1'] ?? '')
  const width = Number.parseInt(config['hw.lcd.width'] ?? '', 10)
  const height = Number.parseInt(config['hw.lcd.height'] ?? '', 10)
  return {
    id,
    displayName: config['avd.ini.displayname'] || id.replace(/_/g, ' '),
    deviceProfile: config['hw.device.name'] ?? '',
    apiLevel,
    platformVersion: androidVersionName(apiLevel),
    ...(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
      ? { screen: { width, height } }
      : {}),
  }
}

/**
 * The payload of an `adb emu` console reply.
 *
 * These ride the emulator's telnet console, which terminates every response with a
 * bare `OK` line. Returning it as part of the value gives you an AVD named
 * "Medium_Phone_API_36.1\nOK", which then matches nothing.
 */
export function parseEmuResponse(stdout: string): string | null {
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  const payload = lines.filter((line) => line !== 'OK' && !line.startsWith('KO'))
  return payload[0] ?? null
}

/**
 * How the emulator is invoked.
 *
 * Headless by default, and that is the whole trick. iOS has to ask the agent in prose
 * never to run `open -a Simulator`, because Apple's simulator window steals the screen
 * and the host cannot put it back. `-no-window` makes the equivalent unrepresentable:
 * the emulator renders nowhere, and the only picture of it is the one inside this app.
 */
export function emulatorLaunchArgs(
  id: string,
  options: { headless?: boolean } = {},
): string[] {
  return [
    '-avd', id,
    ...(options.headless === false ? [] : ['-no-window']),
    '-no-audio',
    // Never write a snapshot on exit. Taking control of a device should not silently
    // rewrite the state the user left it in, and the save costs seconds on shutdown.
    '-no-snapshot-save',
  ]
}

/** A launched emulator process. */
export interface AvdLaunch {
  process: ChildProcess
  /** Resolves when it exits, however that happens. Never rejects. */
  exited: Promise<number | null>
  stop(): void
}

export class Avd {
  constructor(
    private readonly emulatorBinary: string,
    private readonly run: RunAdb,
    private readonly home: string = avdHome(),
  ) {}

  async list(signal?: AbortSignal): Promise<AvdSummary[]> {
    const result = await this.run(['-list-avds'], {
      timeoutMs: 15_000,
      ...(signal ? { signal } : {}),
    })
    // A non-zero exit with names on stdout still means those names are real; the
    // emulator returns failure for the crash-db warning above on some machines.
    const ids = parseAvdList(result.stdout.toString('utf8'))
    return Promise.all(ids.map((id) => this.describe(id)))
  }

  /**
   * Read one AVD's config, degrading to just its id when the files are unreadable.
   *
   * A config that cannot be parsed is not a reason to hide the AVD: the emulator will
   * still boot it, and dropping it would leave the user staring at a catalog missing
   * the device they can see in Android Studio.
   */
  private async describe(id: string): Promise<AvdSummary> {
    try {
      const outerPath = join(this.home, `${id}.ini`)
      const outer = await readFile(outerPath, 'utf8')
      const dir = parseIni(outer).path ?? join(this.home, `${id}.avd`)
      const config = await readFile(join(dir, 'config.ini'), 'utf8').catch(() => '')
      return parseAvdConfig(id, outer, config)
    } catch {
      return parseAvdConfig(id, '', '')
    }
  }

  /** Start an emulator. See `emulatorLaunchArgs` for why it is headless. */
  launch(id: string, options: { headless?: boolean } = {}): AvdLaunch {
    const child = spawn(this.emulatorBinary, emulatorLaunchArgs(id, options), {
      stdio: ['ignore', 'pipe', 'pipe'],
      // Same process group, so a clean quit can still signal it — see `dispose` on the
      // manager. The kernel does NOT take it down with this app, though: `emulator`
      // execs into a qemu process that is simply reparented, which is why stopping one
      // goes through its own console rather than through this handle.
      detached: false,
    })
    const exited = new Promise<number | null>((resolve) => {
      child.on('close', (code) => resolve(code))
      child.on('error', () => resolve(null))
    })
    return {
      process: child,
      exited,
      stop: () => { child.kill('SIGTERM') },
    }
  }
}

#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export type RebuildPlatform = 'ios' | 'android'

export type RebuildOptions = {
  help: boolean
  dryRun: boolean
  platform: RebuildPlatform
  clean: boolean
  runArgs: string[]
}

export function parseRebuildArgs(argv: string[], hostPlatform = process.platform): RebuildOptions {
  if (argv.includes('--help')) {
    return { help: true, dryRun: false, platform: 'ios', clean: false, runArgs: [] }
  }
  const runArgs: string[] = []
  let platform: RebuildPlatform | undefined
  let clean = false
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--clean') {
      clean = true
      continue
    }
    if (arg === '--dry-run') {
      dryRun = true
      continue
    }
    if (arg === '--platform') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('Missing value for --platform')
      if (value !== 'ios' && value !== 'android') throw new Error('--platform must be ios or android')
      platform = value
      i += 1
      continue
    }
    runArgs.push(arg)
  }
  return {
    help: false,
    dryRun,
    platform: platform ?? (hostPlatform === 'darwin' ? 'ios' : 'android'),
    clean,
    runArgs,
  }
}

export function rebuildCommands(options: RebuildOptions) {
  const chatView = ['bun', 'run', 'build:chat-view']
  const prebuild = ['bunx', 'expo', 'prebuild', '-p', options.platform]
  if (options.clean) prebuild.push('--clean')
  const nativeRun = ['bunx', 'expo', `run:${options.platform}`, ...options.runArgs]
  return [chatView, prebuild, nativeRun]
}

export type AdbDevice = {
  serial: string
  state: string
}

const ADB_DEVICE_LINE = /^(.+?)\s+(device|offline|unauthorized|no permissions)(?:\s|$)/
const MDNS_CONNECT_TARGET = /_adb-tls-connect\._tcp(\d+\.\d+\.\d+\.\d+:\d+)/g

export function parseAdbDevices(output: string): AdbDevice[] {
  const devices: AdbDevice[] = []
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('List of devices')) continue
    const match = trimmed.match(ADB_DEVICE_LINE)
    if (match) devices.push({ serial: match[1], state: match[2] })
  }
  return devices
}

export function serialsExpoCannotAddress(devices: AdbDevice[]): string[] {
  // Expo CLI splits `adb devices -l` on spaces, so a wireless duplicate named
  // `adb-xxx (2)._adb-tls-connect._tcp` becomes `adb -s adb-xxx` and fails.
  return devices.filter((device) => /\s/.test(device.serial)).map((device) => device.serial)
}

export function parseMdnsConnectTargets(output: string): string[] {
  return [...new Set([...output.matchAll(MDNS_CONNECT_TARGET)].map((match) => match[1]))]
}

export function adbConnectSucceeded(output: string) {
  const text = output.toLowerCase()
  return text.includes('connected to') && !text.includes('failed to connect')
}

function adbBin() {
  const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT
  if (sdk) {
    const candidate = join(sdk, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb')
    if (existsSync(candidate)) return candidate
  }
  return 'adb'
}

function expoSafeAttached(devices: AdbDevice[]) {
  return devices.filter((device) => device.state === 'device' && !/\s/.test(device.serial))
}

export function helpText() {
  return `Rebuild the Expo development client after native deps or config plugins change.

Usage:
  bun run rebuild:mobile:ios
  bun run rebuild:mobile:android
  bun run rebuild:mobile:ios -- --clean
  bun run rebuild:mobile:ios -- --device <udid> --no-bundler

--clean      regenerate the native project from scratch
--no-bundler skip Metro when bun run dev:mobile is already running
--dry-run    print commands without executing
Other flags are forwarded to expo run:<platform>.`
}

function spawnCommand(command: string[], env: NodeJS.ProcessEnv, inherit: boolean) {
  return new Promise<string>((resolveRun, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: mobile,
      env,
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolveRun(stdout)
      else reject(new Error(`${command.join(' ')} exited with status ${code}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

function run(command: string[], env = process.env) {
  return spawnCommand(command, env, true).then(() => undefined)
}

function capture(command: string[], env = process.env) {
  return spawnCommand(command, env, false)
}

async function connectMdnsTargets(adb: string, env: NodeJS.ProcessEnv, targets: string[]) {
  for (const target of targets) {
    console.log(`Connecting wireless ADB as ${target}`)
    const output = await capture([adb, 'connect', target], env).catch((error) =>
      error instanceof Error ? error.message : String(error),
    )
    if (adbConnectSucceeded(output)) return
  }
}

async function sanitizeAndroidDevices(env = process.env) {
  const adb = adbBin()
  const listed = parseAdbDevices(await capture([adb, 'devices', '-l'], env))
  const unsafe = serialsExpoCannotAddress(listed)
  if (unsafe.length === 0 && expoSafeAttached(listed).length > 0) return

  const targets = parseMdnsConnectTargets(await capture([adb, 'mdns', 'services'], env).catch(() => ''))
  if (unsafe.length > 0) {
    // mDNS auto-connects the duplicate again within seconds unless the daemon
    // is restarted with auto-connect off. Expo then picks the spaced serial.
    console.log('Restarting adb with ADB_MDNS_AUTO_CONNECT=0 to drop Expo-incompatible wireless serials')
    await capture([adb, 'kill-server'], env).catch(() => undefined)
    await capture([adb, 'start-server'], env)
  }
  await connectMdnsTargets(adb, env, targets)
  if (expoSafeAttached(parseAdbDevices(await capture([adb, 'devices', '-l'], env))).length > 0) return

  throw new Error(
    'No Android device Expo can address. Wireless ADB sometimes lists a duplicate serial with a space (e.g. "adb-xxx (2)._adb-tls-connect._tcp"), which Expo CLI misparses as `adb -s adb-xxx`. Plug in USB, start an emulator, or reconnect with `adb connect IP:PORT`.',
  )
}

function javaHome() {
  return [
    process.env.JAVA_HOME,
    '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
    '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home',
  ].find((path) => path && existsSync(join(path, 'bin/java')))
}

export async function rebuildDevClient(options: RebuildOptions, hostPlatform = process.platform) {
  if (options.help) {
    console.log(helpText())
    return
  }
  if (options.platform === 'ios' && hostPlatform !== 'darwin') {
    throw new Error('iOS rebuild requires macOS')
  }
  const env = {
    ...process.env,
    LANG: 'en_US.UTF-8',
    LC_ALL: 'en_US.UTF-8',
  }
  if (options.platform === 'android') {
    const java = javaHome()
    if (!java) throw new Error('Set JAVA_HOME to a Java 17+ installation (Android Studio includes one).')
    env.JAVA_HOME = java
    env.ADB_MDNS_AUTO_CONNECT = '0'
    if (!options.dryRun) await sanitizeAndroidDevices(env)
  }

  for (const command of rebuildCommands(options)) {
    console.log(`$ ${command.join(' ')}`)
    if (!options.dryRun) await run(command, env)
  }
}

const invokedDirectly = Boolean(process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
if (invokedDirectly) {
  rebuildDevClient(parseRebuildArgs(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

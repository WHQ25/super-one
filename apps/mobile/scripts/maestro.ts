import { spawn, execFileSync } from 'node:child_process'
import { get } from 'node:http'
import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mobile = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const version = '2.10.0'
const checksum = '29b675e10cc12080e445e9bfb2e2b4e4dfb9c0f2e30d5884120d258b5e1cd991'
const local = join(mobile, '.tools/maestro/bin/maestro')
const args = process.argv.slice(2)
const option = (name: string, fallback?: string) => {
  const index = args.indexOf(name)
  if (index < 0) return fallback
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
  return value
}

async function run(command: string[], env = process.env) {
  await new Promise<void>((resolveRun, reject) => {
    const child = spawn(command[0], command.slice(1), { cwd: mobile, env, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', (code) => code === 0 ? resolveRun() : reject(new Error(`${command[0]} exited with status ${code}`)))
  })
}

function metroReady(port: string): Promise<boolean> {
  return new Promise((resolveReady) => {
    const request = get(`http://127.0.0.1:${port}/status`, (response) => {
      let body = ''
      response.on('data', (chunk) => { body += chunk })
      response.on('end', () => resolveReady(response.statusCode === 200 && body.includes('packager-status:running')))
    })
    request.setTimeout(3000, () => { request.destroy(); resolveReady(false) })
    request.on('error', () => resolveReady(false))
  })
}

async function install() {
  if (process.platform !== 'darwin' && process.platform !== 'linux') throw new Error('Install Maestro using its official Windows instructions, then set MAESTRO_BINARY.')
  const response = await fetch(`https://github.com/mobile-dev-inc/Maestro/releases/download/cli-${version}/maestro.zip`)
  if (!response.ok) throw new Error(`Maestro download failed: HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (createHash('sha256').update(bytes).digest('hex') !== checksum) throw new Error('Maestro archive checksum mismatch')
  const tools = join(mobile, '.tools')
  await mkdir(tools, { recursive: true })
  const archive = join(tools, `maestro-${version}.zip`)
  await writeFile(archive, bytes)
  await run(['unzip', '-qo', archive, '-d', tools])
  await chmod(local, 0o755)
  await rm(archive)
  console.log(`Installed verified Maestro ${version} at ${local}`)
}

async function test() {
  const binary = process.env.MAESTRO_BINARY || (existsSync(local) ? local : (process.env.PATH ?? '').split(delimiter).map((path) => join(path, 'maestro')).find(existsSync))
  if (!binary) throw new Error('Run bun run setup:ui first, or set MAESTRO_BINARY.')
  const java = [process.env.JAVA_HOME, '/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home'].find((path) => path && existsSync(join(path, 'bin/java')))
  if (!java) throw new Error('Set JAVA_HOME to a Java 17+ installation (Android Studio includes one).')
  const platform = option('--platform', 'ios')!
  if (!['ios', 'android'].includes(platform)) throw new Error('--platform must be ios or android')
  let device = option('--device')?.replace(/^(ios-sim:|android:)/, '')
  if (!device && platform === 'ios') {
    const data = JSON.parse(execFileSync('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'], { encoding: 'utf8' })) as { devices: Record<string, { udid: string; state: string }[]> }
    const devices = Object.values(data.devices).flat().filter((item) => item.state === 'Booted')
    if (devices.length !== 1) throw new Error('Pass --device with the UDID shown by SuperOne; no unique booted simulator was found.')
    device = devices[0].udid
  }
  if (!device) throw new Error('Pass --device with the device ID shown by SuperOne.')
  const theme = option('--theme', 'light')!
  if (!['light', 'dark', 'all'].includes(theme)) throw new Error('--theme must be light, dark, or all')
  const flow = option('--flow')
  if (flow && !/^[a-z-]+$/.test(flow)) throw new Error('--flow expects a flow name such as config-edit')
  const flowPath = flow ? join(mobile, '.maestro/flows', `${flow}.yaml`) : join(mobile, '.maestro')
  if (!existsSync(flowPath)) throw new Error(`Flow does not exist: ${flowPath}`)
  const port = option('--metro-port', '8082')!
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid --metro-port')
  if (!await metroReady(port)) throw new Error(`Start the preview first: bun run preview --port ${port}`)
  const app = JSON.parse(await readFile(join(mobile, 'app.json'), 'utf8')).expo
  const appId: string = platform === 'ios' ? app.ios.bundleIdentifier : app.android.package
  if (!args.includes('--skip-launch')) {
    const metroHost = platform === 'ios' ? '127.0.0.1' : '10.0.2.2'
    const url = `exp+superone://expo-development-client/?url=${encodeURIComponent(`http://${metroHost}:${port}`)}`
    if (platform === 'ios') await run(['xcrun', 'simctl', 'openurl', device, url])
    else await run(['adb', '-s', device, 'shell', 'am', 'start', '-a', 'android.intent.action.VIEW', '-d', url])
  }
  const env = { ...process.env, JAVA_HOME: java, MAESTRO_CLI_NO_ANALYTICS: '1', MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: 'true' }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  for (const appearance of theme === 'all' ? ['light', 'dark'] : [theme]) {
    const artifacts = join(mobile, '.maestro/artifacts', stamp, appearance)
    await mkdir(artifacts, { recursive: true })
    console.log(`Maestro ${platform} device=${device}, theme=${appearance}\nArtifacts: ${artifacts}\nDo not send SuperOne device actions while this test is running.`)
    await run([binary, '--device', device, 'test', '--format', 'junit', '--output', join(artifacts, 'report.xml'), '--test-output-dir', artifacts, '-e', `APP_ID=${appId}`, '-e', `THEME=${appearance}`, flowPath], env)
  }
}

try {
  if (args.includes('--install')) await install()
  else if (args.includes('--help')) console.log('bun run setup:ui\nbun run test:ui [--device ios-sim:UDID] [--theme light|dark|all] [--flow config-edit] [--metro-port 8082] [--platform ios|android] [--skip-launch]')
  else await test()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}

#!/usr/bin/env bun
/**
 * Desktop-node lab: a second dev desktop ("B") on this Mac that serves node
 * access, so the desktop you run with `bun run dev` ("A") can pair with it and
 * launch collaboration children on it. Usage and what A and B share:
 * `apps/desktop/docs/agent-reference/testing.md` ("Testing desktop as a node on one machine").
 *
 *   bun scripts/desktop-node-lab.ts start | pair | status | stop
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { encodeNodePairingCode } from '../packages/shared/src/environment/node-pairing-code'

const ROOT = resolve(import.meta.dir, '..')
const DESKTOP = join(ROOT, 'apps', 'desktop')
const INSTANCE = process.env.SUPERONE_LAB_INSTANCE ?? 'node-b'
const NODE_PORT = Number(process.env.SUPERONE_LAB_NODE_PORT ?? 7794)
const CDP_PORT = Number(process.env.SUPERONE_LAB_CDP_PORT ?? 9334)
const RENDERER_PORT = Number(process.env.SUPERONE_LAB_RENDERER_PORT ?? 5174)

// Same layout as `src/main/index.ts` for an unpackaged SUPERONE_INSTANCE.
const USER_DATA = join(DESKTOP, '.dev-data', `instance-${INSTANCE}`)
const LAB = join(USER_DATA, 'lab')
const PIDS = join(LAB, 'pids.json')
// B's own SuperOne home; installed harness runtimes are shared with A's dev home.
const SUPERONE_HOME = process.env.SUPERONE_LAB_HOME ?? join(LAB, 'superone-home')
const HARNESS_HOME = process.env.SUPERONE_LAB_HARNESS_HOME ?? join(homedir(), '.superone', 'dev', 'harness')
const PROJECTS_DIR = process.env.SUPERONE_LAB_PROJECTS_DIR ?? join(LAB, 'projects')

interface Pids { renderer: number; electron: number }

function readJson(file: string): Record<string, unknown> {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown> } catch { return {} }
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function runningPids(): Pids | null {
  const pids = readJson(PIDS) as Partial<Pids>
  return pids.electron && alive(pids.electron) ? pids as Pids : null
}

async function reachable(url: string): Promise<boolean> {
  try { return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok } catch { return false }
}

async function waitFor(what: string, url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await reachable(url)) return
    await Bun.sleep(500)
  }
  throw new Error(`${what} not ready at ${url} after ${timeoutMs / 1000}s (logs: ${LAB})`)
}

function startDetached(name: string, cmd: string[], env: Record<string, string>): number {
  const out = openSync(join(LAB, `${name}.log`), 'w')
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: DESKTOP,
    env: { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', out, out],
  })
  closeSync(out)
  child.unref()
  return child.pid!
}

/** Evaluate an expression in B's main window over CDP and return its value. */
async function evaluateInB<T>(expression: string): Promise<T> {
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json() as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>
  const page = targets.find((t) => t.type === 'page' && t.url.startsWith(`http://localhost:${RENDERER_PORT}/`))
  if (!page) throw new Error(`B's window is not open (CDP targets: ${targets.map((t) => t.url).join(', ')})`)
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
  try {
    const reply = await new Promise<{ result: { result: { value: T }; exceptionDetails?: { text: string; exception?: { description?: string } } } }>((ok) => {
      ws.onmessage = (event) => ok(JSON.parse(String(event.data)))
      ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
    const error = reply.result.exceptionDetails
    if (error) throw new Error(error.exception?.description ?? error.text)
    return reply.result.result.value
  } finally {
    ws.close()
  }
}

async function start(): Promise<void> {
  try {
    await launch()
  } catch (error) {
    await stop()
    throw error
  }
  await pair()
}

async function launch(): Promise<void> {
  if (runningPids()) {
    console.log(`B (${INSTANCE}) is already running; \`bun run dev:desktop-node:lab:stop\` first to restart it.`)
    return
  }
  for (const [what, url] of [['node port', `http://127.0.0.1:${NODE_PORT}/health`], ['CDP port', `http://127.0.0.1:${CDP_PORT}/json/version`], ['renderer port', `http://localhost:${RENDERER_PORT}/`]] as const) {
    if (await reachable(url)) throw new Error(`${what} is taken (${url}); set SUPERONE_LAB_${what.split(' ')[0].toUpperCase()}_PORT`)
  }
  // B runs A's main/preload build; build it once if nothing has (`bun run dev` does).
  if (!existsSync(join(DESKTOP, 'out', 'main', 'bootstrap.js'))) {
    console.log('No main build in apps/desktop/out yet; building once…')
    const build = Bun.spawnSync(['bunx', 'electron-vite', 'build'], { cwd: DESKTOP, stdout: 'inherit', stderr: 'inherit' })
    if (build.exitCode !== 0) throw new Error('electron-vite build failed')
  }

  mkdirSync(LAB, { recursive: true })
  mkdirSync(PROJECTS_DIR, { recursive: true })
  // Node access on from the first launch, on a port of its own (shown under the experimental flag).
  const settingsFile = join(USER_DATA, 'app-settings.json')
  writeJson(settingsFile, { ...readJson(settingsFile), experimentalRemoteNodesEnabled: true, remoteNodeAccessEnabled: true, remoteNodeAccessPort: NODE_PORT })
  const nodeConfigFile = join(USER_DATA, 'node-host', 'config.json')
  const nodeConfig = readJson(nodeConfigFile) as { agent?: Record<string, unknown> }
  if (!nodeConfig.agent?.projectsDir) writeJson(nodeConfigFile, { ...nodeConfig, agent: { ...nodeConfig.agent, projectsDir: PROJECTS_DIR } })

  // Its own renderer dev server, so A's `bun run dev` keeps 5173 and B never rebuilds A's out/.
  const renderer = startDetached('renderer', ['bunx', 'electron-vite', 'dev', '--rendererOnly'], { VITE_PORT: String(RENDERER_PORT) })
  writeJson(PIDS, { renderer, electron: 0 })
  await waitFor('renderer dev server', `http://localhost:${RENDERER_PORT}/`, 60_000)

  const electronBin = createRequire(join(DESKTOP, 'package.json'))('electron') as string
  const electron = startDetached('electron', [electronBin, '.', `--remote-debugging-port=${CDP_PORT}`], {
    NODE_ENV: 'development',
    ELECTRON_RENDERER_URL: `http://localhost:${RENDERER_PORT}`,
    SUPERONE_INSTANCE: INSTANCE,
    SUPERONE_HOME,
    SUPERONE_HARNESS_HOME: HARNESS_HOME,
  })
  writeJson(PIDS, { renderer, electron })
  await waitFor('B window (CDP)', `http://127.0.0.1:${CDP_PORT}/json/version`, 60_000)
  await waitFor('B node host', `http://127.0.0.1:${NODE_PORT}/health`, 60_000)
  console.log(`B (${INSTANCE}) is up: node http://127.0.0.1:${NODE_PORT}, CDP ${CDP_PORT}, renderer ${RENDERER_PORT}`)
  console.log(`  profile ${USER_DATA}\n  log     ${join(DESKTOP, `instance-${INSTANCE}-dev.log`)}`)
}

async function pair(): Promise<void> {
  if (!runningPids()) throw new Error(`B (${INSTANCE}) is not running; start it with \`bun run dev:desktop-node:lab\``)
  await waitFor('B window (CDP)', `http://127.0.0.1:${CDP_PORT}/json/version`, 30_000)
  // A fresh profile opens its window a moment after CDP is up.
  const deadline = Date.now() + 30_000
  while (!(await evaluateInB<boolean>("typeof window.app?.mintNodeHostPairingToken === 'function'").catch(() => false))) {
    if (Date.now() > deadline) throw new Error(`B's window did not load (log: ${join(DESKTOP, `instance-${INSTANCE}-dev.log`)})`)
    await Bun.sleep(500)
  }
  const token = await evaluateInB<Parameters<typeof encodeNodePairingCode>[0]>('window.app.mintNodeHostPairingToken()')
  console.log(`\nPairing code for A (single use, expires ${new Date(token.expiresAt).toLocaleTimeString()}):\n\n${encodeNodePairingCode(token)}\n`)
  console.log('Paste it in A: Settings → Remote Control → Control Other Devices → Add Desktop.')
}

async function status(): Promise<void> {
  const pids = runningPids()
  console.log(pids ? `B (${INSTANCE}) running: electron pid ${pids.electron}, renderer pid ${pids.renderer}` : `B (${INSTANCE}) not running`)
  console.log(`node host  ${await reachable(`http://127.0.0.1:${NODE_PORT}/health`) ? 'up' : 'down'} (:${NODE_PORT})`)
  console.log(`CDP        ${await reachable(`http://127.0.0.1:${CDP_PORT}/json/version`) ? 'up' : 'down'} (:${CDP_PORT})`)
}

async function stop(): Promise<void> {
  const pids = readJson(PIDS) as Partial<Pids>
  for (const pid of [pids.electron, pids.renderer]) {
    if (!pid || !alive(pid)) continue
    // Each was started as its own process group; take its helpers down with it.
    try { process.kill(-pid, 'SIGTERM') } catch { process.kill(pid, 'SIGTERM') }
  }
  const deadline = Date.now() + 10_000
  while ([pids.electron, pids.renderer].some((pid) => pid && alive(pid)) && Date.now() < deadline) await Bun.sleep(200)
  for (const pid of [pids.electron, pids.renderer]) {
    if (pid && alive(pid)) try { process.kill(-pid, 'SIGKILL') } catch { /* already gone */ }
  }
  rmSync(PIDS, { force: true })
  console.log(`B (${INSTANCE}) stopped. Its profile stays in ${USER_DATA}; delete it for a fresh node.`)
}

const commands: Record<string, () => Promise<void>> = { start, pair, status, stop }
const command = commands[process.argv[2] ?? '']
if (!command) {
  console.error('Usage: bun scripts/desktop-node-lab.ts start | pair | status | stop')
  process.exit(1)
}
await command().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

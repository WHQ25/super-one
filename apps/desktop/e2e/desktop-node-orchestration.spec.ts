/**
 * Desktop A runs collaboration children on desktop B, end to end, without a
 * model: both run the scripted harness (`src/main/session/backends/scripted-backend.ts`).
 * B mints a node pairing code, A pairs with it, and A's parent
 * session spawns children on B for a repository B has to clone from a
 * loopback `origin`.
 */
import { test, expect, type Page } from '@playwright/test'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { decodeNodePairingCode } from '@superone/shared/environment/node-pairing-code'
import { launchDesktop, mainPid, removeInstanceData, type DesktopInstance } from './fixtures/desktop-instance'

const A_NAME = 'e2e-node-a'
const B_NAME = 'e2e-node-b'
const NODE_PORT = 7899
const GIT_DAEMON_PORT = 19418
const SCRIPTED = { SUPERONE_E2E_SCRIPTED_HARNESS: '1' }

test.describe.configure({ mode: 'serial', timeout: 180_000 })

let root: string
let projectPath: string
let projectsDirB: string
let envB: Record<string, string>
let a: DesktopInstance
let b: DesktopInstance
let environmentId: string
let gitDaemon: ChildProcess | undefined

type RecordedEvent = Record<string, any>

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args], { cwd, encoding: 'utf8' }).trim()
}

/** A turn script; `<` is escaped so a nested child script is not this turn's. */
function scripted(steps: unknown[]): string {
  return `<scripted>${JSON.stringify(steps).replace(/</g, '\\u003c')}</scripted>`
}

function stoppedWake(childName: string): RegExp {
  return new RegExp(`Received: Your collaboration child SuperOne session \\S+ \\("${childName}[^"]*"\\) stopped`)
}

/** English UI with remote nodes (experimental) shown, as the steps below read it. */
const UI_SETTINGS = { locale: 'en', experimentalRemoteNodesEnabled: true }

async function launchB(fresh: boolean): Promise<DesktopInstance> {
  return launchDesktop(B_NAME, {
    fresh,
    env: envB,
    seed: fresh
      ? {
          'app-settings.json': { ...UI_SETTINGS, remoteNodeAccessPort: NODE_PORT },
          // Allow Control on: B turns every controller away without it.
          'remote-config.json': { enabled: true, masterSecret: '00'.repeat(32), deviceId: B_NAME, relayUrl: '' },
          // Where B clones a repository it lacks (`agent.projectsDir`).
          'node-host/config.json': { agent: { projectsDir: projectsDirB } },
        }
      : {},
  })
}

/** Settings → Remote Control, on the given tab. */
async function openRemoteSettings(page: Page, tab: 'Control This Mac' | 'Control Other Devices'): Promise<void> {
  await page.keyboard.press('Meta+Comma')
  await page.getByRole('button', { name: 'Remote Control', exact: true }).click()
  await page.getByRole('tab', { name: tab }).click()
}

/** Keep every agent event A's renderer receives, for the assertions below. */
async function recordEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __e2eEvents?: unknown[]; agent: { onAgentEvent(cb: (e: unknown) => void): void } }
    if (w.__e2eEvents) return
    w.__e2eEvents = []
    w.agent.onAgentEvent((event) => w.__e2eEvents!.push(event))
  })
}

async function events(sessionId: string): Promise<RecordedEvent[]> {
  return a.window.evaluate((sid) =>
    (window as unknown as { __e2eEvents: RecordedEvent[] }).__e2eEvents.filter((e) => e.sessionId === sid), sessionId)
}

/** Assistant text and tool results the session streamed, one per line. */
async function output(sessionId: string): Promise<string> {
  return (await events(sessionId))
    .filter((e) => e.type === 'content_delta' && (e.delta?.type === 'text' || e.delta?.type === 'tool_result'))
    .map((e) => e.delta.text ?? e.delta.summary)
    .join('\n')
}

/** Approve the next collaboration confirm card the parent opens. */
async function approveConfirmCard(sessionId: string): Promise<void> {
  const handle = await a.window.waitForFunction((sid) => {
    const recorded = (window as unknown as { __e2eEvents: RecordedEvent[] }).__e2eEvents
    const event = recorded.find((e) => e.type === 'permission_request' && e.sessionId === sid
      && e.request?.requestKind === 'session_agents_confirm' && !e.__handled)
    if (!event) return null
    event.__handled = true
    return event.request.requestId as string
  }, sessionId, { timeout: 60_000 })
  const requestId = await handle.jsonValue()
  const ok = await a.window.evaluate(([sid, id]) =>
    (window as unknown as { agent: { respondToPermission(s: string, r: string, a: boolean): Promise<boolean> } }).agent.respondToPermission(sid, id, true), [sessionId, requestId] as const)
  expect(ok).toBe(true)
}

async function startParent(content: string): Promise<string> {
  return a.window.evaluate(async ([project, text]) => {
    const w = window as unknown as {
      app: { addRecentFolder(p: string): Promise<boolean> }
      agent: { createSession(p: string): Promise<string>; sendMessage(p: string, r: { content: string; sessionId: string }): Promise<void> }
    }
    await w.app.addRecentFolder(project)
    const sessionId = await w.agent.createSession(project)
    await w.agent.sendMessage(project, { content: text, sessionId })
    return sessionId
  }, [projectPath, content] as const)
}

function spawnLaunch(launchId: string, name: string) {
  return {
    launchId,
    mode: 'spawn',
    environment: environmentId,
    agentId: 'claude-base',
    name,
    role: 'Worker',
    summary: `E2E child ${name}`,
    config: { permissionMode: 'bypassPermissions' },
  }
}

test.beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'superone-e2e-node-'))
  const origin = path.join(root, 'origin.git')
  projectPath = path.join(root, 'a', 'app')
  projectsDirB = path.join(root, 'b-projects')
  await mkdir(path.dirname(projectPath), { recursive: true })
  await mkdir(projectsDirB, { recursive: true })
  git(root, 'init', '--bare', '--initial-branch=main', origin)
  git(root, 'clone', '--quiet', origin, projectPath)
  await writeFile(path.join(projectPath, 'README.md'), '# e2e\n')
  git(projectPath, 'add', '.')
  git(projectPath, 'commit', '--quiet', '-m', 'init')
  git(projectPath, 'push', '--quiet', '-u', 'origin', 'main')
  // A remote launch needs a clone URL another machine can use (https/ssh/git),
  // so serve the bare repo read-only over a loopback git daemon: offline, no credentials.
  gitDaemon = spawn('git', ['daemon', '--export-all', '--reuseaddr', `--base-path=${root}`, '--listen=127.0.0.1', `--port=${GIT_DAEMON_PORT}`, root], { stdio: 'ignore' })
  git(projectPath, 'remote', 'set-url', 'origin', `git://127.0.0.1:${GIT_DAEMON_PORT}/origin.git`)
  await expect.poll(() => {
    try { return git(projectPath, 'ls-remote', 'origin', 'main') } catch { return '' }
  }).toContain('refs/heads/main')

  // Separate homes keep each side's worktrees (`~/.worktrees`) and SUPERONE_HOME apart.
  const homeA = path.join(root, 'home-a')
  const homeB = path.join(root, 'home-b')
  await mkdir(homeA, { recursive: true })
  await mkdir(homeB, { recursive: true })
  envB = { ...SCRIPTED, HOME: homeB }
  a = await launchDesktop(A_NAME, { env: { ...SCRIPTED, HOME: homeA }, seed: { 'app-settings.json': UI_SETTINGS } })
  b = await launchB(true)
  await recordEvents(a.window)
})

test.afterAll(async () => {
  await a?.app.close().catch(() => {})
  await b?.app.close().catch(() => {})
  gitDaemon?.kill()
  if (process.env.E2E_KEEP) {
    console.log('[e2e] kept', root)
    return
  }
  if (root) await rm(root, { recursive: true, force: true })
  await removeInstanceData(A_NAME)
  await removeInstanceData(B_NAME)
})

test('A pairs with B from a node code B mints', async () => {
  // A phone carries this code between the two in the product; the e2e build
  // exposes the same mint and pair steps directly (`desktop-pairing.ts`).
  const code = await b.window.evaluate(() =>
    (window as unknown as { app: { devMintNodePairingCode(): Promise<string> } }).app.devMintNodePairingCode())
  expect(code).toMatch(/^superone-node:/)
  await a.window.evaluate((value) =>
    (window as unknown as { environment: { devPairNodeCode(code: string): Promise<void> } }).environment.devPairNodeCode(value), code)

  environmentId = decodeNodePairingCode(code).environmentId
  const paired = await a.window.evaluate(async (id) => {
    const items = await (window as unknown as { environment: { listItems(): Promise<Array<{ kind: string; environmentId: string }>> } }).environment.listItems()
    return items.some((item) => item.kind === 'remote' && item.environmentId === id)
  }, environmentId)
  expect(paired).toBe(true)

  // B lists A among the desktops that run tasks on it.
  await openRemoteSettings(b.window, 'Control This Mac')
  await expect(b.window.getByRole('button', { name: 'Remove' }).first()).toBeVisible({ timeout: 30_000 })
  await b.window.keyboard.press('Meta+Comma')
})

test('children spawned on B clone the repo; a report reaches the mailbox and a silent stop wakes the parent', async () => {
  const parent = await startParent(scripted([
    { tool: 'session_collab_request', args: { launches: [spawnLaunch('reporter', 'Rae'), spawnLaunch('silent', 'Sid')] } },
    { tool: 'session_collab_start', args: { launchId: 'reporter', task: scripted([{ tool: 'session_collab_send', args: { content: 'REPORT-FROM-B' } }]) } },
    { tool: 'session_collab_start', args: { launchId: 'silent', task: scripted([{ say: 'finished without reporting' }]) } },
  ]))
  await approveConfirmCard(parent)

  await expect.poll(() => output(parent), { timeout: 90_000 }).toMatch(/"status":"started"[\s\S]*"machine":"[^"]+"[\s\S]*"status":"started"/)
  // B had no project for this origin, so it cloned one into its projects directory.
  expect(existsSync(path.join(projectsDirB, 'origin', '.git'))).toBe(true)

  // Rae's report lands in A's mailbox (the initiator owns it) and wakes the parent.
  await expect.poll(async () => {
    const messages = await a.window.evaluate((sid) =>
      (window as unknown as { app: { collaborationMailbox: { list(s: string): Promise<Array<{ content: string }>> } } }).app.collaborationMailbox.list(sid), parent)
    return messages.map((m) => m.content).join('\n')
  }, { timeout: 90_000 }).toContain('REPORT-FROM-B')
  await expect.poll(() => output(parent), { timeout: 60_000 }).toMatch(/Received: A collaboration mailbox message is ready\. It is from SuperOne session \S+ \("Rae/)

  // Sid stops without reporting: the fallback wake.
  await expect.poll(() => output(parent), { timeout: 90_000 }).toMatch(stoppedWake('Sid'))
  // Rae reported before stopping, so its stop wakes nobody.
  expect(await output(parent)).not.toMatch(stoppedWake('Rae'))
})

test('a child still running when B crashes wakes the parent once B is back', async () => {
  const parent = await startParent(scripted([
    { tool: 'session_collab_request', args: { launches: [spawnLaunch('sleeper', 'Zed')] } },
    { tool: 'session_collab_start', args: { launchId: 'sleeper', task: scripted([{ sleep: 600_000 }]) } },
  ]))
  await approveConfirmCard(parent)
  await expect.poll(() => output(parent), { timeout: 90_000 }).toMatch(/"status":"started"[\s\S]*"name":"Zed"/)

  // Crash B mid-run, then start it again on the same profile and port.
  process.kill(await mainPid(b), 'SIGKILL')
  await b.app.close().catch(() => {})
  b = await launchB(false)

  await expect.poll(() => output(parent), { timeout: 120_000 }).toMatch(stoppedWake('Zed'))
})

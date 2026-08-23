import { randomUUID } from 'crypto'
import { join } from 'path'
import { app, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { MiniAppHostInfo } from '@superone/shared/miniapp-types'
import log from '../logger'
import { closeMiniAppStatePaths, handleMiniAppStateRequest, type MiniAppStateOp, type MiniAppStateScope, type MiniAppStoragePaths } from './miniapp-state'

const TOOL_TIMEOUT_MS = 120_000
const ACTION_TIMEOUT_MS = 60_000
const STOP_GRACE_MS = 2_000

export interface MiniAppHostStartArgs extends MiniAppStoragePaths {
  appId: string
  projectDir: string
  name: string
  appPath: string
  entryPath: string
  /**
   * `manifest.background`. A host without it is UI-bound and is released with
   * its last panel, so "alive" means "running in the background" for every
   * host the platform reports — no self-reported status involved.
   */
  background: boolean
}

/** Runs a host action in the renderer, which owns the UI and its consent prompts. */
export type MiniAppHostActionRunner = (
  request: { appId: string; projectDir: string; action: string; args: Record<string, unknown> },
) => Promise<unknown>

let runHostAction: MiniAppHostActionRunner | null = null

export function setMiniAppHostActionRunner(runner: MiniAppHostActionRunner): void {
  runHostAction = runner
}

interface PendingCall {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface MiniAppHostInstance extends MiniAppHostStartArgs {
  process: UtilityProcess
  since: number
  /**
   * Liveness is tracked here, not via `process.pid`: Electron leaves `pid`
   * undefined until the child has spawned, so a pid check treats a starting
   * host as dead and forks a second, orphaned one.
   */
  alive: boolean
  ready: boolean
  readyPromise: Promise<void>
  resolveReady(): void
  rejectReady(error: Error): void
  statusText: string
  pending: Map<string, PendingCall>
}

let getMainWindow: (() => BrowserWindow | null) | null = null
let getLocale: () => string = () => 'en'
const instances = new Map<string, MiniAppHostInstance>()
/**
 * Start args kept so a host that died on its own (crash, activation failure)
 * can be respawned by the next tool call. Cleared on explicit stop/uninstall,
 * where staying down is the user's intent.
 */
const restartArgs = new Map<string, MiniAppHostStartArgs>()

function key(projectDir: string, appId: string): string {
  return `${projectDir}::${appId}`
}

export function initMiniAppHost(
  mainWindowGetter: () => BrowserWindow | null,
  localeGetter: () => string,
): void {
  getMainWindow = mainWindowGetter
  getLocale = localeGetter
}

function rejectPending(instance: MiniAppHostInstance, message: string): void {
  for (const pending of instance.pending.values()) {
    clearTimeout(pending.timer)
    pending.reject(new Error(message))
  }
  instance.pending.clear()
}

function emitState(): void {
  const win = getMainWindow?.()
  if (!win || win.isDestroyed()) return
  win.webContents.send(AgentIpcChannels.MINIAPP_HOST_STATE, { hosts: listMiniAppHosts() })
}

function handleMessage(instance: MiniAppHostInstance, raw: unknown): void {
  const message = raw as Record<string, unknown>
  switch (message?.type) {
    case 'ready':
      instance.ready = true
      instance.resolveReady()
      emitState()
      return
    case 'activation-error':
      // Deterministic: loading the same entry again would fail the same way.
      restartArgs.delete(key(instance.projectDir, instance.appId))
      instance.rejectReady(new Error(`Mini-app activation failed: ${String(message.error ?? 'unknown error')}`))
      rejectPending(instance, `Mini-app activation failed: ${String(message.error ?? 'unknown error')}`)
      log.error('[miniapp-host] activation failed %s: %s', key(instance.projectDir, instance.appId), message.error)
      return
    case 'tool-result': {
      const callId = String(message.callId ?? '')
      const pending = instance.pending.get(callId)
      if (!pending) return
      clearTimeout(pending.timer)
      instance.pending.delete(callId)
      if (message.error) pending.reject(new Error(String(message.error)))
      else pending.resolve(message.result)
      return
    }
    case 'webview-message': {
      const win = getMainWindow?.()
      if (!win || win.isDestroyed()) return
      win.webContents.send(AgentIpcChannels.MINIAPP_HOST_MESSAGE, {
        appId: instance.appId,
        projectDir: instance.projectDir,
        payload: message.payload,
      })
      return
    }
    case 'state-request': {
      const requestId = String(message.requestId ?? '')
      const scope = message.scope as MiniAppStateScope
      const op = message.op as MiniAppStateOp
      void Promise.resolve()
        .then(() => handleMiniAppStateRequest(instance.appId, instance, scope, op, message.key as string | undefined, message.value))
        .then((result) => instance.process.postMessage({ type: 'state-response', requestId, result }))
        .catch((error) => instance.process.postMessage({
          type: 'state-response',
          requestId,
          error: error instanceof Error ? error.message : String(error),
        }))
      return
    }
    case 'host-action': {
      const requestId = String(message.requestId ?? '')
      const action = String(message.action ?? '')
      const args = (message.args ?? {}) as Record<string, unknown>
      const respond = (payload: Record<string, unknown>) => {
        if (instance.alive) instance.process.postMessage({ type: 'action-response', requestId, ...payload })
      }
      if (!runHostAction) {
        respond({ error: 'Host actions are unavailable' })
        return
      }
      const timer = setTimeout(() => respond({ error: `Host action timed out: ${action}` }), ACTION_TIMEOUT_MS)
      timer.unref?.()
      void runHostAction({ appId: instance.appId, projectDir: instance.projectDir, action, args })
        .then((result) => { clearTimeout(timer); respond({ result }) })
        .catch((error) => {
          clearTimeout(timer)
          respond({ error: error instanceof Error ? error.message : String(error) })
        })
      return
    }
    case 'status':
      instance.statusText = String(message.text ?? '').slice(0, 120)
      emitState()
      return
  }
}

export function startMiniAppHost(args: MiniAppHostStartArgs): MiniAppHostInfo {
  const instanceKey = key(args.projectDir, args.appId)
  const existing = instances.get(instanceKey)
  if (existing?.alive) return snapshot(existing)
  restartArgs.set(instanceKey, args)

  const child = utilityProcess.fork(join(__dirname, 'miniapp-host-entry.js'), [], {
    cwd: args.projectDir,
    serviceName: `SuperOne MiniApp: ${args.name}`,
    stdio: 'pipe',
    env: {
      ...process.env,
      SUPERONE_MINIAPP_APP_ID: args.appId,
      SUPERONE_MINIAPP_PROJECT_DIR: args.projectDir,
      SUPERONE_MINIAPP_APP_PATH: args.appPath,
      SUPERONE_MINIAPP_ENTRY_PATH: args.entryPath,
      SUPERONE_MINIAPP_WORKSPACE_STORAGE_PATH: args.workspaceStoragePath,
      SUPERONE_MINIAPP_GLOBAL_STORAGE_PATH: args.globalStoragePath,
      SUPERONE_MINIAPP_VERSION: app.getVersion(),
      SUPERONE_MINIAPP_LOCALE: getLocale(),
    },
  })

  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  // A host may fail before an agent invokes a tool. Keep the rejection observed;
  // executeMiniAppTool still receives it through the chained promise below.
  void readyPromise.catch(() => {})
  const instance: MiniAppHostInstance = {
    ...args,
    process: child,
    since: Date.now(),
    alive: true,
    ready: false,
    readyPromise,
    resolveReady,
    rejectReady,
    statusText: '',
    pending: new Map(),
  }
  instances.set(instanceKey, instance)

  child.on('message', (message) => handleMessage(instance, message))
  child.on('exit', (code) => {
    instance.alive = false
    if (instances.get(instanceKey) !== instance) return
    const error = new Error(`Mini-app '${args.appId}' exited with code ${code}`)
    if (!instance.ready) instance.rejectReady(error)
    rejectPending(instance, error.message)
    instances.delete(instanceKey)
    closeMiniAppStatePaths(instance)
    emitState()
  })
  child.stdout?.on('data', (chunk) => log.info('[miniapp:%s] %s', args.appId, String(chunk).trimEnd()))
  child.stderr?.on('data', (chunk) => log.error('[miniapp:%s] %s', args.appId, String(chunk).trimEnd()))
  emitState()
  return snapshot(instance)
}

function snapshot(instance: MiniAppHostInstance): MiniAppHostInfo {
  return {
    appId: instance.appId,
    projectDir: instance.projectDir,
    name: instance.name,
    since: instance.since,
    ready: instance.ready,
    background: instance.background,
    ...(instance.statusText ? { statusText: instance.statusText } : {}),
  }
}

export function listMiniAppHosts(): MiniAppHostInfo[] {
  return [...instances.values()].filter((instance) => instance.alive).map(snapshot)
}

/**
 * Quit-confirmation input. Every opened mini-app owns a host, so being alive
 * proves nothing; what does is the manifest declaring `background`, since only
 * those are kept past their panel. Deliberately not keyed on
 * `context.setStatus()` — an app must not decide whether the user is warned.
 */
export function hasActiveMiniAppHosts(): boolean {
  return [...instances.values()].some((instance) => instance.alive && instance.background)
}

/**
 * A host that died on its own leaves tools permanently broken for the session,
 * so respawn it lazily on the next use. Explicit stops clear `restartArgs`, so
 * they stay stopped.
 */
function resolveRunningInstance(projectDir: string, appId: string): MiniAppHostInstance | null {
  const instanceKey = key(projectDir, appId)
  const instance = instances.get(instanceKey)
  if (instance?.alive) return instance
  const args = restartArgs.get(instanceKey)
  if (!args) return null
  log.info('[miniapp-host] respawning %s after it stopped unexpectedly', instanceKey)
  startMiniAppHost(args)
  return instances.get(instanceKey) ?? null
}

export function executeMiniAppTool(
  projectDir: string,
  appId: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const instance = resolveRunningInstance(projectDir, appId)
  if (!instance) return Promise.reject(new Error(`MiniApp Host is not running for '${appId}'`))

  return instance.readyPromise.then(() => {
    const callId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        instance.pending.delete(callId)
        reject(new Error(`Mini-app tool timed out after ${TOOL_TIMEOUT_MS}ms: ${tool}`))
      }, TOOL_TIMEOUT_MS)
      instance.pending.set(callId, { resolve, reject, timer })
      instance.process.postMessage({ type: 'tool-call', callId, tool, args })
    })
  })
}

/** Broadcast to every live host — locale is global, context-consumed is per app. */
function broadcast(message: Record<string, unknown>, match?: (instance: MiniAppHostInstance) => boolean): void {
  for (const instance of instances.values()) {
    if (!instance.alive || (match && !match(instance))) continue
    void instance.readyPromise
      .then(() => { if (instance.alive) instance.process.postMessage(message) })
      .catch(() => { /* host died before it could hear about it */ })
  }
}

export function notifyMiniAppHostsLocale(locale: string): void {
  broadcast({ type: 'locale-changed', locale })
}

export function notifyMiniAppContextConsumed(appId: string): void {
  broadcast({ type: 'context-consumed' }, (instance) => instance.appId === appId)
}

export function postMiniAppWebviewMessage(projectDir: string, appId: string, payload: unknown): void {
  const instance = resolveRunningInstance(projectDir, appId)
  if (!instance) {
    log.warn('[miniapp-host] dropped WebView message for %s: host is not running', appId)
    return
  }
  void instance.readyPromise
    .then(() => {
      if (instances.get(key(projectDir, appId)) === instance && instance.alive) {
        instance.process.postMessage({ type: 'webview-message', payload })
      }
    })
    .catch((error) => log.warn('[miniapp-host] dropped WebView message for %s: %s', appId, error))
}

/** Ask the mini-app to deactivate, then force-kill if it does not exit in time. */
function terminate(instance: MiniAppHostInstance): void {
  const child = instance.process
  const forceKill = setTimeout(() => {
    if (child.pid !== undefined) child.kill()
  }, STOP_GRACE_MS)
  forceKill.unref()
  child.once('exit', () => clearTimeout(forceKill))
  child.postMessage({ type: 'deactivate' })
}

export interface MiniAppHostStopOptions {
  /** Keep the start args so a later tool call can lazily respawn the host. */
  respawnable?: boolean
}

export function stopMiniAppHost(projectDir: string, appId: string, options?: MiniAppHostStopOptions): void {
  const instanceKey = key(projectDir, appId)
  if (!options?.respawnable) restartArgs.delete(instanceKey)
  const instance = instances.get(instanceKey)
  if (!instance) return
  instance.alive = false
  instances.delete(instanceKey)
  closeMiniAppStatePaths(instance)
  if (!instance.ready) instance.rejectReady(new Error(`Mini-app '${appId}' stopped`))
  rejectPending(instance, `Mini-app '${appId}' stopped`)
  // A host stopped inside its spawn window has no pid to talk to yet; waiting
  // for 'spawn' is what keeps it from surviving as an orphan.
  if (instance.process.pid === undefined) instance.process.once('spawn', () => terminate(instance))
  else terminate(instance)
  emitState()
}

/**
 * The last panel for an app closed. A UI-bound host has nothing left to serve,
 * so it goes down rather than linger as an invisible process; it stays
 * respawnable because its tools remain registered for the session, and an agent
 * call pulls it back up through `resolveRunningInstance`. A host that declared
 * `background` is left alone — outliving the panel is what it declared.
 */
export function releaseMiniAppHost(projectDir: string, appId: string): void {
  const instance = instances.get(key(projectDir, appId))
  if (!instance || instance.background) return
  stopMiniAppHost(projectDir, appId, { respawnable: true })
}

export function stopMiniAppHostsByAppId(appId: string): void {
  for (const instance of [...instances.values()]) {
    if (instance.appId === appId) stopMiniAppHost(instance.projectDir, instance.appId)
  }
}

export function stopAllMiniAppHosts(): void {
  for (const instance of [...instances.values()]) stopMiniAppHost(instance.projectDir, instance.appId)
}

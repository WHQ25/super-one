import { pathToFileURL } from 'url'
import type {
  SuperOneMiniAppContext,
  SuperOneMiniAppDisposable,
  SuperOneMiniAppLocale,
  SuperOneMiniAppModule,
  SuperOneMiniAppToastType,
} from '@superone/shared/miniapp-host-api'

interface ParentPort {
  postMessage(message: unknown): void
  on(event: 'message', listener: (event: { data: unknown }) => void): void
}

type HostMessage =
  | { type: 'tool-call'; callId: string; tool: string; args: Record<string, unknown> }
  | { type: 'webview-message'; payload: unknown }
  | { type: 'state-response'; requestId: string; result?: unknown; error?: string }
  | { type: 'action-response'; requestId: string; result?: unknown; error?: string }
  | { type: 'locale-changed'; locale: SuperOneMiniAppLocale }
  | { type: 'context-consumed' }
  | { type: 'deactivate' }

interface MiniAppHostEnv {
  appId: string
  projectDir: string
  appPath: string
  entryPath: string
  workspaceStoragePath: string
  globalStoragePath: string
  version: string
  locale: string
}

const parentPort = (process as NodeJS.Process & { parentPort?: ParentPort }).parentPort
if (!parentPort) throw new Error('MiniApp Host requires an Electron utility-process parentPort')

function requiredEnv(name: keyof MiniAppHostEnv): string {
  const value = process.env[`SUPERONE_MINIAPP_${name.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`]
  if (!value) throw new Error(`Missing MiniApp Host environment: ${name}`)
  return value
}

const env: MiniAppHostEnv = {
  appId: requiredEnv('appId'),
  projectDir: requiredEnv('projectDir'),
  appPath: requiredEnv('appPath'),
  entryPath: requiredEnv('entryPath'),
  workspaceStoragePath: requiredEnv('workspaceStoragePath'),
  globalStoragePath: requiredEnv('globalStoragePath'),
  version: requiredEnv('version'),
  locale: requiredEnv('locale'),
}

const toolHandlers = new Map<string, (args: Record<string, unknown>) => unknown | Promise<unknown>>()
const webviewHandlers = new Set<(message: unknown) => void>()
const subscriptions: SuperOneMiniAppDisposable[] = []
let appModule: SuperOneMiniAppModule | null = null
let stateRequestId = 0
const pendingStateRequests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
let actionRequestId = 0
const pendingActionRequests = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>()
const contextConsumedHandlers = new Set<() => void>()
const localeHandlers = new Set<(locale: SuperOneMiniAppLocale) => void>()
let currentLocale = (env.locale === 'zh' ? 'zh' : 'en') as SuperOneMiniAppLocale

function disposable(dispose: () => void | Promise<void>): SuperOneMiniAppDisposable {
  return { dispose }
}

function requestState(scope: 'workspace' | 'global', op: 'get' | 'update' | 'keys', key?: string, value?: unknown): Promise<unknown> {
  const requestId = String(++stateRequestId)
  return new Promise((resolve, reject) => {
    pendingStateRequests.set(requestId, { resolve, reject })
    parentPort.postMessage({ type: 'state-request', requestId, scope, op, key, value })
  })
}

/** Host actions run in the renderer, which owns the UI and the consent prompts. */
function requestAction(action: string, args?: Record<string, unknown>): Promise<unknown> {
  const requestId = String(++actionRequestId)
  return new Promise((resolve, reject) => {
    pendingActionRequests.set(requestId, { resolve, reject })
    parentPort.postMessage({ type: 'host-action', requestId, action, args: args ?? {} })
  })
}

function createState(scope: 'workspace' | 'global') {
  return {
    get<T = unknown>(key: string): Promise<T | undefined> {
      return requestState(scope, 'get', key) as Promise<T | undefined>
    },
    update(key: string, value: unknown | undefined): Promise<void> {
      return requestState(scope, 'update', key, value) as Promise<void>
    },
    keys(): Promise<string[]> {
      return requestState(scope, 'keys') as Promise<string[]>
    },
  }
}

const context: SuperOneMiniAppContext = {
  appId: env.appId,
  appPath: env.appPath,
  version: env.version,
  workspace: {
    rootPath: env.projectDir,
    storagePath: env.workspaceStoragePath,
  },
  globalStoragePath: env.globalStoragePath,
  workspaceState: createState('workspace'),
  globalState: createState('global'),
  subscriptions,
  tools: {
    handle(name, handler) {
      if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Invalid tool name: ${name}`)
      if (toolHandlers.has(name)) throw new Error(`Tool already registered: ${name}`)
      toolHandlers.set(name, handler)
      return disposable(() => { if (toolHandlers.get(name) === handler) toolHandlers.delete(name) })
    },
  },
  webview: {
    postMessage(payload) {
      parentPort.postMessage({ type: 'webview-message', payload })
    },
    onMessage(handler) {
      webviewHandlers.add(handler)
      return disposable(() => { webviewHandlers.delete(handler) })
    },
  },
  agent: {
    sendPrompt(text) { return requestAction('agent.sendPrompt', { text: String(text) }) as Promise<void> },
    setContext(opts) { return requestAction('agent.setContext', { ...opts }) as Promise<void> },
    clearContext() { return requestAction('agent.clearContext') as Promise<void> },
    onContextConsumed(handler) {
      contextConsumedHandlers.add(handler)
      return disposable(() => { contextConsumedHandlers.delete(handler) })
    },
  },
  host: {
    toast(message, type) {
      return requestAction('host.toast', { message: String(message), toastType: type ?? 'info' }) as Promise<void>
    },
    revealInFolder(path) { return requestAction('host.revealInFolder', { path: String(path) }) as Promise<void> },
    openExternal(url) { return requestAction('host.openExternal', { url: String(url) }) as Promise<void> },
    clipboard: {
      read() { return requestAction('host.clipboard.read') as Promise<string> },
      write(text) { return requestAction('host.clipboard.write', { text: String(text) }) as Promise<void> },
    },
  },
  locale: {
    get() { return currentLocale },
    onChange(handler) {
      localeHandlers.add(handler)
      return disposable(() => { localeHandlers.delete(handler) })
    },
  },
  setStatus(text) {
    parentPort.postMessage({ type: 'status', text: String(text).slice(0, 120) })
  },
}

async function deactivate(): Promise<void> {
  try {
    await appModule?.deactivate?.()
  } finally {
    for (const entry of subscriptions.splice(0).reverse()) {
      try { await entry.dispose() } catch { /* best-effort shutdown */ }
    }
    toolHandlers.clear()
    webviewHandlers.clear()
    contextConsumedHandlers.clear()
    localeHandlers.clear()
    for (const pending of pendingActionRequests.values()) pending.reject(new Error('MiniApp Host is shutting down'))
    pendingActionRequests.clear()
    for (const pending of pendingStateRequests.values()) pending.reject(new Error('MiniApp Host is shutting down'))
    pendingStateRequests.clear()
  }
}

parentPort.on('message', async (event) => {
  const message = event.data as HostMessage
  if (!message || typeof message.type !== 'string') return
  if (message.type === 'tool-call') {
    const handler = toolHandlers.get(message.tool)
    if (!handler) {
      parentPort.postMessage({ type: 'tool-result', callId: message.callId, error: `Mini-app did not register tool: ${message.tool}` })
      return
    }
    try {
      const result = await handler(message.args ?? {})
      parentPort.postMessage({ type: 'tool-result', callId: message.callId, result })
    } catch (error) {
      parentPort.postMessage({
        type: 'tool-result',
        callId: message.callId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }
  if (message.type === 'action-response') {
    const pending = pendingActionRequests.get(message.requestId)
    if (!pending) return
    pendingActionRequests.delete(message.requestId)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
    return
  }
  if (message.type === 'locale-changed') {
    currentLocale = message.locale === 'zh' ? 'zh' : 'en'
    for (const handler of localeHandlers) {
      try { handler(currentLocale) } catch { /* isolate listeners */ }
    }
    return
  }
  if (message.type === 'context-consumed') {
    for (const handler of contextConsumedHandlers) {
      try { handler() } catch { /* isolate listeners */ }
    }
    return
  }
  if (message.type === 'state-response') {
    const pending = pendingStateRequests.get(message.requestId)
    if (!pending) return
    pendingStateRequests.delete(message.requestId)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
    return
  }
  if (message.type === 'webview-message') {
    for (const handler of webviewHandlers) {
      try { handler(message.payload) } catch { /* isolate listeners */ }
    }
    return
  }
  if (message.type === 'deactivate') {
    await deactivate()
    process.exit(0)
  }
})

try {
  const loaded = await import(pathToFileURL(env.entryPath).href) as Partial<SuperOneMiniAppModule>
  if (typeof loaded.activate !== 'function') {
    throw new Error(`MiniApp Host entry must export activate(context): ${env.entryPath}`)
  }
  appModule = loaded as SuperOneMiniAppModule
  await appModule.activate(context)
  parentPort.postMessage({ type: 'ready' })
} catch (error) {
  parentPort.postMessage({ type: 'activation-error', error: error instanceof Error ? error.stack ?? error.message : String(error) })
  setImmediate(() => process.exit(1))
}

process.once('SIGTERM', () => { void deactivate().finally(() => process.exit(0)) })

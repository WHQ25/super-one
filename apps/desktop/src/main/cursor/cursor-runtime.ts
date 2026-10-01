import { app } from 'electron'
import { trace } from '../agent/event-trace'
import log from '../logger'
import {
  createCursorRuntime as createCore,
  prewarmCursorLocalWorkspace as prewarmCore,
  type CursorRuntime,
  type CursorRuntimeOptions as CoreCursorRuntimeOptions,
  type CursorSendOptions,
  type CursorConfig,
} from '@superone/cursor'
import { resolveCursorApiKey } from './cursor-auth'
import { buildCursorMcpServers } from './cursor-mcp'
import { closeCompatSession, type CompatSession } from '../mcp-apps/compat-registry'

export type { CursorRuntime, CursorSendOptions, CursorConfig }

/** Desktop runtime options — Electron / MCP / decrypt are injected. */
export type CursorRuntimeOptions = Omit<
  CoreCursorRuntimeOptions,
  'userDataRoot' | 'resolveApiKey' | 'buildMcpServers' | 'log' | 'onSdkTrace'
>

export type CursorRuntimeFactory = (
  opts: CursorRuntimeOptions,
) => Promise<CursorRuntime>

/**
 * Desktop Cursor runtime: injects Electron userData, secret decrypt, and MCP.
 */
function injectDesktopRuntime(opts: CursorRuntimeOptions, compat?: CompatSession): CoreCursorRuntimeOptions {
  return {
    ...opts,
    userDataRoot: app.getPath('userData'),
    resolveApiKey: resolveCursorApiKey,
    buildMcpServers: buildCursorMcpServers,
    onEvent: event => opts.onEvent(compat?.attach(event) ?? event),
    log,
    onSdkTrace: trace,
  }
}

export async function createCursorRuntime(
  opts: CursorRuntimeOptions,
): Promise<CursorRuntime> {
  const compat = await prepareCompat(opts)
  try {
    const runtime = await createCore(injectDesktopRuntime(opts, compat))
    return { ...runtime, close: async () => {
      try { await runtime.close() } finally { if (compat) await closeCompatSession(opts.sessionId, compat) }
    } }
  } catch (error) {
    if (compat) await closeCompatSession(opts.sessionId, compat)
    throw error
  }
}

async function prepareCompat(opts: CursorRuntimeOptions): Promise<CompatSession | undefined> {
  const { readCursorConfig } = await import('@superone/cursor')
  const config = readCursorConfig(opts.config)
  // Compat cannot reproduce SDK sandbox policy; keep those servers native.
  // Use the requested value, even if the SDK later falls back on this platform.
  const sandboxRequested = opts.sandboxEnabled ?? config.sandboxEnabled ?? false
  if (config.runtime === 'cloud' || opts.providerSessionId?.startsWith('bc-') || sandboxRequested) {
    await closeCompatSession(opts.sessionId)
    return
  }
  const { prepareCompatSession } = await import('../mcp-apps/compat-session')
  return prepareCompatSession(opts.sessionId, opts.cwd)
}

/** Official SDK workspace prewarm — does not create an Agent. */
export async function prewarmCursorWorkspace(opts: CursorRuntimeOptions): Promise<void> {
  const compat = await prepareCompat(opts)
  return prewarmCore(injectDesktopRuntime({
    ...opts,
    onEvent: opts.onEvent ?? (() => undefined),
  }, compat))
}

let desktopFactory: CursorRuntimeFactory = createCursorRuntime

/** Override desktop Cursor runtime factory (tests). */
export function setCursorRuntimeFactory(factory: CursorRuntimeFactory | null): void {
  desktopFactory = factory ?? createCursorRuntime
}

/** Return the active desktop Cursor runtime factory. */
export function getCursorRuntimeFactory(): CursorRuntimeFactory {
  return desktopFactory
}

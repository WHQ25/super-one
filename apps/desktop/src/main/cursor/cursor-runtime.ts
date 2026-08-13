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
function injectDesktopRuntime(opts: CursorRuntimeOptions): CoreCursorRuntimeOptions {
  return {
    ...opts,
    userDataRoot: app.getPath('userData'),
    resolveApiKey: resolveCursorApiKey,
    buildMcpServers: buildCursorMcpServers,
    log,
    onSdkTrace: trace,
  }
}

export async function createCursorRuntime(
  opts: CursorRuntimeOptions,
): Promise<CursorRuntime> {
  return createCore(injectDesktopRuntime(opts))
}

/** Official SDK workspace prewarm — does not create an Agent. */
export function prewarmCursorWorkspace(opts: CursorRuntimeOptions): Promise<void> {
  return prewarmCore(injectDesktopRuntime({
    ...opts,
    onEvent: opts.onEvent ?? (() => undefined),
  }))
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

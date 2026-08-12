import { app } from 'electron'
import log from '../logger'
import {
  createCursorRuntime as createCore,
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
  'userDataRoot' | 'resolveApiKey' | 'buildMcpServers' | 'log'
>

export type CursorRuntimeFactory = (
  opts: CursorRuntimeOptions,
) => Promise<CursorRuntime>

/**
 * Desktop Cursor runtime: injects Electron userData, secret decrypt, and MCP.
 */
export async function createCursorRuntime(
  opts: CursorRuntimeOptions,
): Promise<CursorRuntime> {
  return createCore({
    ...opts,
    userDataRoot: app.getPath('userData'),
    resolveApiKey: resolveCursorApiKey,
    buildMcpServers: buildCursorMcpServers,
    log,
  })
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

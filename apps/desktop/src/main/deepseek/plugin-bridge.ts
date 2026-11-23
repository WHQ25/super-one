import { BrowserWindow } from 'electron'
import { PluginRpcNotFoundError, readClientPluginEntries, type DeepseekRuntime } from '@superone/deepseek'
import { AgentIpcChannels } from '@superone/shared/agent-types'
import type { DshClientPluginList, DshPluginRpcResult } from '@superone/shared/dsh-plugin-client'
import { dshPluginRoot, peekDeepseekRuntime } from './deepseek-runtime-host'

const RPC_TIMEOUT_MS = 15_000

const AUXILIARY_WINDOW_MODES = ['mode=dragpreview', 'mode=computer-use-permissions']

export function isBusinessWindow(win: BrowserWindow): boolean {
  if (win.isDestroyed()) return false
  const wc = win.webContents
  if (!wc || wc.isDestroyed()) return false
  const url = typeof wc.getURL === 'function' ? wc.getURL() : ''
  return !AUXILIARY_WINDOW_MODES.some((marker) => url.includes(marker))
}

function broadcastToBusinessWindows(channel: string, ...args: unknown[]): void {
  if (typeof BrowserWindow?.getAllWindows !== 'function') return
  for (const win of BrowserWindow.getAllWindows()) {
    if (!isBusinessWindow(win)) continue
    try {
      win.webContents.send(channel, ...args)
    } catch {
      continue
    }
  }
}

export function broadcastDshPluginsChanged(): void {
  broadcastToBusinessWindows(AgentIpcChannels.DSH_PLUGINS_CHANGED)
}

export async function listDshClientPlugins(): Promise<DshClientPluginList> {
  return await readClientPluginEntries(dshPluginRoot())
}

export async function invokeDshPluginRpc(
  pluginId: string,
  method: string,
  payload?: unknown,
  timeoutMs = RPC_TIMEOUT_MS,
): Promise<DshPluginRpcResult> {
  const runtime = await peekDeepseekRuntime()
  if (!runtime) {
    return {
      ok: false,
      error: {
        code: 'runtime_not_running',
        message: 'DeepSeek runtime is not running',
      },
    }
  }
  const rpc = runtime.context.get('pluginRpc')
  if (!rpc) {
    return {
      ok: false,
      error: {
        code: 'rpc_unavailable',
        message: 'Plugin RPC service is not available',
      },
    }
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const data = await Promise.race([
      rpc.invoke(pluginId, method, payload),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Plugin RPC timed out after ${timeoutMs}ms`)), timeoutMs)
      }),
    ])
    return { ok: true, data }
  } catch (error) {
    const code = error instanceof PluginRpcNotFoundError ? error.code : 'rpc_error'
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code, message } }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function attachPluginRpcEvents(runtime: DeepseekRuntime): () => void {
  const rpc = runtime.context.get('pluginRpc')
  if (!rpc) return () => {}
  return rpc.subscribe((message) => {
    broadcastToBusinessWindows(AgentIpcChannels.DSH_PLUGIN_RPC_EVENT, message)
  })
}

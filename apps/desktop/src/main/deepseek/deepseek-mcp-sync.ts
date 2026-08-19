import { listDshMcpConfigs, type McpManageOptions } from '@superone/runtime/fs'
import type { DeepseekMcpServerSpec } from '@superone/deepseek'
import log from '../logger'
import { peekDeepseekRuntime } from './deepseek-runtime-host'
import { watchDshMcpConfig, type DshMcpWatchOptions } from './deepseek-mcp-watcher'

/**
 * dsh's own MCP servers, from its own file.
 *
 * SuperOne extends a harness rather than centralizing it, so this reads
 * `~/.dsh/profiles/<profile>/cordis.patch.yml` — the entries the user's own dsh
 * CLI writes — not the Claude-shaped config other harnesses share. dsh composes
 * per deployment, so every server is user scope; SSE is dropped because
 * `dsh-mcp-client` speaks stdio and Streamable HTTP only.
 */
export function readDshMcpServerSpecs(cwd: string, opts?: McpManageOptions): DeepseekMcpServerSpec[] {
  const specs: DeepseekMcpServerSpec[] = []
  for (const config of listDshMcpConfigs(cwd, opts)) {
    if (config.disabled) continue
    const name = config.name?.trim()
    if (!name) continue
    if (config.type === 'stdio') {
      const command = config.command?.trim()
      if (!command) continue
      specs.push({
        name,
        transport: 'stdio',
        command,
        args: config.args ?? [],
        env: config.env ?? {},
        cwd,
      })
      continue
    }
    if (config.type !== 'http') {
      log.info('[deepseek] skipping MCP server %s: %s transport is not supported', name, config.type)
      continue
    }
    const url = config.url?.trim()
    if (!url) continue
    specs.push({ name, transport: 'streamable-http', url, headers: config.headers ?? {} })
  }
  return specs
}

let unwatch: (() => void) | null = null
let activeCwd: string | null = null

/**
 * Follow dsh's MCP config for as long as DeepSeek sessions are running.
 *
 * Creating an agent already syncs from a fresh read, so this only covers the
 * other case: an edit that lands *while* sessions are live. `cwd` is the newest
 * session's — it only decorates stdio servers, and the mounts themselves are
 * deployment-level, so the last session to start supplies it (the same rule
 * that applied before the watch existed).
 */
export function trackDshMcpConfig(cwd: string, opts?: DshMcpWatchOptions): void {
  activeCwd = cwd
  if (unwatch) return
  unwatch = watchDshMcpConfig(() => void resyncDshMcpServers(opts), opts)
}

export function stopTrackingDshMcpConfig(): void {
  unwatch?.()
  unwatch = null
  activeCwd = null
}

/** Exported for tests; the watcher is the only production caller. */
export async function resyncDshMcpServers(opts?: McpManageOptions): Promise<void> {
  const cwd = activeCwd
  if (!cwd) return
  // A file change must never boot a tree that is not running: the next session
  // reads the config on its own.
  const runtime = await peekDeepseekRuntime()
  if (!runtime) return
  try {
    await runtime.syncMcpServers(readDshMcpServerSpecs(cwd, opts))
  } catch (error) {
    log.error('[deepseek] MCP config resync failed', error)
  }
}

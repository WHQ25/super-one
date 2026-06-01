export interface BridgeStartupDeps {
  connect: () => Promise<void>
  loadTools: () => Promise<void>
  connectStdio: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
}

export interface BridgeStartupResult {
  ipcReady: boolean
}

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_BASE_DELAY_MS = 150
const DEFAULT_MAX_DELAY_MS = 2_000

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function retry(
  attempt: () => Promise<void>,
  deps: Pick<BridgeStartupDeps, 'sleep' | 'log'> & {
    maxAttempts: number
    baseDelayMs: number
    maxDelayMs: number
    label: string
  },
): Promise<boolean> {
  for (let i = 1; i <= deps.maxAttempts; i++) {
    try {
      await attempt()
      return true
    } catch (err) {
      deps.log(`${deps.label} attempt ${i}/${deps.maxAttempts} failed: ${message(err)}`)
      if (i < deps.maxAttempts) {
        await deps.sleep(Math.min(deps.baseDelayMs * 2 ** (i - 1), deps.maxDelayMs))
      }
    }
  }
  return false
}

/**
 * Drives bridge startup so the MCP stdio handshake never dies on transient IPC
 * failures. Codex snapshots `tools/list` once at startup and never re-lists on
 * `notifications/tools/list_changed`, so the full tool set must be loaded BEFORE
 * the stdio transport is connected — but a transient socket hiccup must retry
 * instead of killing the process. If the IPC never comes up within the retry
 * budget, stdio is still connected so codex receives the synchronously-registered
 * built-in tool floor rather than a dead server.
 */
export async function startBridgeRuntime(deps: BridgeStartupDeps): Promise<BridgeStartupResult> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const retryDeps = { sleep: deps.sleep, log: deps.log, maxAttempts, baseDelayMs, maxDelayMs }

  let ipcReady = false
  const connected = await retry(deps.connect, { ...retryDeps, label: 'ipc connect' })
  if (connected) {
    ipcReady = await retry(deps.loadTools, { ...retryDeps, label: 'ipc tools/list' })
  }
  if (!ipcReady) {
    deps.log('ipc startup exhausted retries; serving built-in tools only')
  }

  await deps.connectStdio()
  return { ipcReady }
}

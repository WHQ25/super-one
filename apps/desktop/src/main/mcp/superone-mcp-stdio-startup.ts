import { SUPERONE_MCP_STARTUP_TIMEOUT_SEC } from './superone-mcp-stdio-env'

export interface BridgeStartupDeps {
  connect: () => Promise<void>
  loadTools: () => Promise<void>
  connectStdio: () => Promise<void>
  sleep: (ms: number) => Promise<void>
  log: (message: string) => void
  maxAttempts?: number
  baseDelayMs?: number
  maxDelayMs?: number
  deadlineMs?: number
}

export interface BridgeStartupResult {
  ipcReady: boolean
}

const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_BASE_DELAY_MS = 150
const DEFAULT_MAX_DELAY_MS = 2_000
// Cap IPC bring-up well under codex's startup timeout so the stdio handshake
// always completes (serving the synchronously-registered built-in floor) before
// codex SIGKILLs the bridge — even if a single `tools/list` hangs past its own
// per-request timeout, which alone exceeds the startup budget. Derived from the
// single SUPERONE_MCP_STARTUP_TIMEOUT_SEC source so the two can't drift apart.
const DEFAULT_STARTUP_DEADLINE_MS = Math.floor(SUPERONE_MCP_STARTUP_TIMEOUT_SEC * 1000 * 0.75)

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
 * `notifications/tools/list_changed`, so the full tool set is loaded BEFORE the
 * stdio transport is connected — but a transient socket hiccup must retry instead
 * of killing the process. The whole IPC bring-up is bounded by `deadlineMs`
 * (default 75% of codex's startup timeout): if connect+loadTools don't finish in
 * time — including a single hung `tools/list` whose per-request timeout alone
 * exceeds codex's budget — stdio is connected anyway so codex receives the
 * synchronously-registered built-in tool floor instead of being SIGKILLed with a
 * dead server. App tools then arrive via the next reload/rebuild.
 */
export async function startBridgeRuntime(deps: BridgeStartupDeps): Promise<BridgeStartupResult> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS
  const baseDelayMs = deps.baseDelayMs ?? DEFAULT_BASE_DELAY_MS
  const maxDelayMs = deps.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
  const deadlineMs = deps.deadlineMs ?? DEFAULT_STARTUP_DEADLINE_MS
  const retryDeps = { sleep: deps.sleep, log: deps.log, maxAttempts, baseDelayMs, maxDelayMs }

  let ipcReady = false
  const bringUp = (async () => {
    const connected = await retry(deps.connect, { ...retryDeps, label: 'ipc connect' })
    if (connected) {
      ipcReady = await retry(deps.loadTools, { ...retryDeps, label: 'ipc tools/list' })
    }
  })()

  // Real timer (not the injected backoff `sleep`) so the deadline holds regardless
  // of how the retry loop is driven; cleared the moment bring-up settles.
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<'deadline'>((resolve) => {
    timer = setTimeout(() => resolve('deadline'), deadlineMs)
  })
  const outcome = await Promise.race([bringUp.then(() => 'bringup' as const), deadline])
  if (timer) clearTimeout(timer)
  void bringUp.catch(() => {})

  if (outcome === 'deadline') {
    deps.log(`ipc startup exceeded ${deadlineMs}ms deadline; serving built-in tools only`)
  } else if (!ipcReady) {
    deps.log('ipc startup exhausted retries; serving built-in tools only')
  }

  await deps.connectStdio()
  return { ipcReady }
}

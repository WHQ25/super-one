/**
 * Minimal Electron-free Codex App Server JSON-RPC client (Stage 4).
 *
 * Lifecycle for one turn:
 * - spawn codex binary: `app-server --listen stdio://`
 * - initialize / initialized
 * - thread/start or thread/resume
 * - turn/start → wait for matching turn/completed (not the turn/start RPC alone)
 * - stream item/agentMessage/delta while the turn runs
 * - respond deny to inbound permission/request methods (no interactive UI yet)
 *
 * Errors returned to callers are redacted; raw stderr is never the public message.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync } from 'node:fs'
import { redactHarnessDiagnosticText } from '@superone/shared/environment'

export type CodexSpawnFn = (
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: boolean
  },
) => ChildProcessWithoutNullStreams

export interface CodexAppServerClientOptions {
  binaryPath: string
  env?: NodeJS.ProcessEnv
  cliArgs?: string[]
  spawnFn?: CodexSpawnFn
  signal?: AbortSignal
  clientVersion?: string
  /** Kill escalation timeout after SIGTERM (ms). Default 2000. */
  killTimeoutMs?: number
}

export interface CodexAppServerHandle {
  request(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
  notify(method: string, params?: Record<string, unknown>): Promise<void>
  /** Await next server notification (or null when closed). */
  nextNotification(timeoutMs?: number): Promise<{ method: string; params: Record<string, unknown> } | null>
  close(): Promise<void>
  /** Redacted stderr snippet for logs only — not for client-facing errors. */
  getStderrRedacted(): string
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_REQUEST_TIMEOUT_MS = 120_000
const THREAD_TIMEOUT_MS = 60_000
const TURN_WAIT_TIMEOUT_MS = 300_000
const MAX_STDERR_CHARS = 8_000

export async function openCodexAppServer(
  opts: CodexAppServerClientOptions,
): Promise<CodexAppServerHandle> {
  if (opts.signal?.aborted) {
    throw new Error('Codex app-server launch interrupted')
  }
  if (!opts.binaryPath || !existsSync(opts.binaryPath)) {
    throw new Error(`Codex binary not found: ${opts.binaryPath || '(empty)'}`)
  }

  const spawnFn = opts.spawnFn ?? defaultSpawn
  const args = [...(opts.cliArgs ?? []), 'app-server', '--listen', 'stdio://']
  const env = { ...process.env, ...(opts.env ?? {}) }
  const child = spawnFn(opts.binaryPath, args, {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  if (!child.stdout || !child.stdin) {
    child.kill()
    throw new Error('Failed to start Codex app-server (missing stdio pipes)')
  }

  let stderrBuf = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderrBuf = (stderrBuf + chunk).slice(-MAX_STDERR_CHARS)
  })

  const rl = createInterface({ input: child.stdout })
  const pending = new Map<number, PendingRequest>()
  const notificationWaiters: Array<{
    resolve: (n: { method: string; params: Record<string, unknown> } | null) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }> = []
  const notificationQueue: Array<{ method: string; params: Record<string, unknown> }> = []
  let nextId = 1
  let closed = false
  let readLoopError: Error | null = null
  /** True only after the OS reports process exit — not merely that kill() was called. */
  let processExited = false

  const writeLine = (payload: Record<string, unknown>) => {
    if (closed) throw new Error('Codex app-server connection closed')
    try {
      child.stdin.write(`${JSON.stringify(payload)}\n`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EPIPE') {
        throw new Error('Codex app-server write failed (broken pipe)')
      }
      throw err
    }
  }

  const failAll = (err: Error) => {
    for (const [, p] of pending) {
      clearTimeout(p.timer)
      p.reject(err)
    }
    pending.clear()
    // Reject notification waiters with the connection error so turn loops do not hot-poll.
    while (notificationWaiters.length) {
      const w = notificationWaiters.shift()!
      clearTimeout(w.timer)
      w.reject(err)
    }
  }

  const pushNotification = (n: { method: string; params: Record<string, unknown> }) => {
    if (notificationWaiters.length) {
      const w = notificationWaiters.shift()!
      clearTimeout(w.timer)
      w.resolve(n)
      return
    }
    notificationQueue.push(n)
  }

  const terminateChild = async (): Promise<void> => {
    if (processExited) return
    const killTimeoutMs = opts.killTimeoutMs ?? 2_000
    await new Promise<void>((resolve) => {
      if (processExited) {
        resolve()
        return
      }
      const onExit = () => {
        clearTimeout(t)
        resolve()
      }
      child.once('exit', onExit)
      try {
        child.kill('SIGTERM')
      } catch {
        child.removeListener('exit', onExit)
        resolve()
        return
      }
      const t = setTimeout(() => {
        if (!processExited) {
          try {
            child.kill('SIGKILL')
          } catch {
            /* ignore */
          }
        }
        // Give a short window for SIGKILL to deliver exit; then resolve anyway.
        setTimeout(() => {
          child.removeListener('exit', onExit)
          resolve()
        }, 500)
      }, killTimeoutMs)
    })
  }

  const onAbort = () => {
    void terminateChild()
  }
  opts.signal?.addEventListener('abort', onAbort)

  child.on('error', (err) => {
    const publicErr = safePublicError('Codex app-server spawn failed', err)
    readLoopError = publicErr
    failAll(publicErr)
  })
  child.on('exit', (code) => {
    processExited = true
    if (!closed) {
      const err = safePublicError(
        'Codex app-server exited unexpectedly',
        new Error(`exit code ${code}`),
      )
      readLoopError = err
      failAll(err)
    }
  })

  void (async () => {
    try {
      for await (const line of rl) {
        const trimmed = `${line}`.trim()
        if (!trimmed) continue
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed)
        } catch {
          continue
        }
        if (!parsed || typeof parsed !== 'object') continue
        const rec = parsed as Record<string, unknown>

        // Inbound server → client request (has method + id): answer deterministically.
        if (typeof rec.method === 'string' && rec.id != null) {
          const id = rec.id
          // Stage 4: no interactive permission UI — deny tool/approval requests.
          try {
            writeLine({
              jsonrpc: '2.0',
              id,
              result: {
                decision: 'deny',
                outcome: { decision: 'deny' },
              },
            })
          } catch {
            /* ignore write failures while shutting down */
          }
          continue
        }

        // JSON-RPC response
        if (rec.id != null && (typeof rec.id === 'number' || typeof rec.id === 'string')) {
          const id = typeof rec.id === 'number' ? rec.id : Number(rec.id)
          const waiter = pending.get(id)
          if (!waiter) continue
          pending.delete(id)
          clearTimeout(waiter.timer)
          if (rec.error) {
            const errObj = rec.error as { message?: string; code?: number }
            waiter.reject(
              safePublicError(errObj.message || `JSON-RPC error ${errObj.code ?? 'unknown'}`),
            )
          } else {
            const result =
              rec.result && typeof rec.result === 'object'
                ? (rec.result as Record<string, unknown>)
                : {}
            waiter.resolve(result)
          }
          continue
        }

        // Notification (method, no id)
        if (typeof rec.method === 'string') {
          const params =
            rec.params && typeof rec.params === 'object'
              ? (rec.params as Record<string, unknown>)
              : {}
          pushNotification({ method: rec.method, params })
        }
      }
    } catch (err) {
      readLoopError = err instanceof Error ? err : new Error(String(err))
      failAll(safePublicError('Codex app-server read failed', readLoopError))
    }
  })()

  const request = (
    method: string,
    params?: Record<string, unknown>,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      if (closed) {
        reject(new Error('Codex app-server connection closed'))
        return
      }
      if (readLoopError) {
        reject(readLoopError)
        return
      }
      if (opts.signal?.aborted) {
        reject(new Error('Codex request interrupted'))
        return
      }
      const id = nextId++
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Codex app-server ${method} timed out after ${timeoutMs}ms`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timer })
      try {
        writeLine({ jsonrpc: '2.0', id, method, params: params ?? {} })
      } catch (err) {
        pending.delete(id)
        clearTimeout(timer)
        reject(safePublicError('Codex app-server write failed', err))
      }
    })

  const notify = async (method: string, params?: Record<string, unknown>) => {
    writeLine({ jsonrpc: '2.0', method, params: params ?? {} })
  }

  const nextNotification = (timeoutMs = 30_000) =>
    new Promise<{ method: string; params: Record<string, unknown> } | null>((resolve, reject) => {
      if (notificationQueue.length) {
        resolve(notificationQueue.shift()!)
        return
      }
      if (readLoopError) {
        reject(readLoopError)
        return
      }
      if (closed) {
        resolve(null)
        return
      }
      const timer = setTimeout(() => {
        const idx = notificationWaiters.findIndex((w) => w.timer === timer)
        if (idx >= 0) notificationWaiters.splice(idx, 1)
        // Idle timeout — only "no notification yet", not connection death.
        if (readLoopError) reject(readLoopError)
        else resolve(null)
      }, timeoutMs)
      notificationWaiters.push({ resolve, reject, timer })
    })

  // Route all stdin stream errors into the connection failure path.
  child.stdin.on('error', (err) => {
    const publicErr = safePublicError('Codex app-server stdin error', err)
    readLoopError = publicErr
    failAll(publicErr)
  })

  const close = async () => {
    if (closed) return
    closed = true
    opts.signal?.removeEventListener('abort', onAbort)
    rl.close()
    try {
      child.stdin.end()
    } catch {
      /* ignore */
    }
    await terminateChild()
    // Intentionally do not failAll with "closed" if already exited with an error.
    if (!readLoopError) {
      failAll(new Error('Codex app-server closed'))
    }
  }

  try {
    await request('initialize', {
      clientInfo: {
        name: 'superone-node',
        title: 'SuperOne Node',
        version: opts.clientVersion ?? '0.0.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })
    await notify('initialized')
  } catch (err) {
    await close()
    throw safePublicError(
      err instanceof Error ? err.message : 'Codex initialize failed',
      err,
    )
  }

  return {
    request: (method, params) =>
      request(
        method,
        params,
        method === 'thread/start' || method === 'thread/resume'
          ? THREAD_TIMEOUT_MS
          : DEFAULT_REQUEST_TIMEOUT_MS,
      ),
    notify,
    nextNotification,
    close,
    getStderrRedacted: () => redactHarnessDiagnosticText(stderrBuf.slice(-500)),
  }
}

/**
 * Run one agent turn against an open client.
 * Waits for turn/completed matching the turn id from turn/start.
 */
export async function runCodexAppServerTurn(opts: {
  client: CodexAppServerHandle
  prompt: string
  cwd: string
  threadId?: string | null
  model?: string
  onDelta: (text: string) => void
  signal: AbortSignal
}): Promise<{ finalText: string; threadId: string | null }> {
  let threadId = opts.threadId ?? null

  if (threadId) {
    const resumed = await opts.client.request('thread/resume', {
      threadId,
      cwd: opts.cwd,
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    })
    const thread = asRecord(resumed.thread)
    const resumedId = readString(thread?.id) ?? readString(resumed.id) ?? threadId
    threadId = resumedId
  } else {
    const started = await opts.client.request('thread/start', {
      cwd: opts.cwd,
      // Stage 4: avoid interactive approvals until permission RPC exists.
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
    })
    const thread = asRecord(started.thread)
    threadId = readString(thread?.id) ?? readString(started.id)
    if (!threadId) {
      throw new Error('thread/start did not return a thread id')
    }
  }

  if (opts.signal.aborted) throw new Error('Codex turn interrupted')

  const turnStartResult = await opts.client.request('turn/start', {
    threadId,
    input: [{ type: 'text', text: opts.prompt, text_elements: [] }],
    ...(opts.model ? { model: opts.model } : {}),
    approvalPolicy: 'never',
    sandboxPolicy: {
      type: 'workspaceWrite',
      writableRoots: [opts.cwd],
    },
  })

  const turn = asRecord(turnStartResult.turn)
  const turnId = readString(turn?.id)
  let finalText = ''
  const deadline = Date.now() + TURN_WAIT_TIMEOUT_MS

  // Collect notifications until matching turn/completed (or connection dies).
  while (!opts.signal.aborted && Date.now() < deadline) {
    let note: { method: string; params: Record<string, unknown> } | null
    try {
      note = await opts.client.nextNotification(Math.min(5_000, Math.max(0, deadline - Date.now())))
    } catch (err) {
      // Connection/process failure — surface immediately (no hot-loop).
      throw err instanceof Error ? err : new Error(String(err))
    }
    if (!note) {
      if (opts.signal.aborted) break
      continue
    }

    applyAgentDelta(note, (delta) => {
      finalText += delta
      opts.onDelta(delta)
    })

    if (note.method === 'turn/completed' || note.method === 'turn/completed/v2') {
      const completedTurn = asRecord(note.params.turn)
      const completedId = readString(completedTurn?.id)
      if (turnId && completedId && completedId !== turnId) {
        // Unrelated turn — keep waiting.
        continue
      }
      const status = readString(completedTurn?.status) ?? readString(note.params.status)
      if (status === 'failed' || status === 'error') {
        throw new Error('Codex turn failed')
      }
      if (status === 'interrupted' || status === 'cancelled') {
        throw new Error('Codex turn interrupted')
      }
      if (!finalText && completedTurn) {
        finalText = extractAgentTextFromTurn(completedTurn)
      }
      return { finalText, threadId }
    }
  }

  if (opts.signal.aborted) {
    throw new Error('Codex turn interrupted')
  }
  throw new Error('Codex turn timed out waiting for turn/completed')
}

function extractAgentTextFromTurn(turn: Record<string, unknown>): string {
  let text = ''
  const items = Array.isArray(turn.items) ? turn.items : []
  for (const item of items) {
    const rec = asRecord(item)
    if (!rec) continue
    if (readString(rec.type) === 'agentMessage' || readString(rec.itemType) === 'agentMessage') {
      const t = readString(rec.text)
      if (t) text += t
    }
  }
  return text
}

function applyAgentDelta(
  note: { method: string; params: Record<string, unknown> },
  onDelta: (text: string) => void,
): void {
  if (note.method === 'item/agentMessage/delta' || note.method === 'item/agentMessageDelta') {
    const delta =
      readString(note.params.delta) ??
      readString(note.params.text) ??
      readString(asRecord(note.params.item)?.delta)
    if (delta) onDelta(delta)
  }
}

/**
 * Build a client-safe Error: redacted message, no raw stderr secrets.
 */
/**
 * Client-safe Error: redacted message only. Raw stderr is never included —
 * callers must not pass free-form subprocess output into durable/remote paths.
 */
export function safePublicError(headline: string, cause?: unknown): Error {
  const causeMsg = cause instanceof Error ? cause.message : cause != null ? String(cause) : ''
  const combined = [headline, causeMsg].filter(Boolean).join(': ')
  return new Error(redactHarnessDiagnosticText(combined).slice(0, 300))
}

function defaultSpawn(
  command: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    windowsHide: boolean
  },
): ChildProcessWithoutNullStreams {
  return spawn(command, args, {
    env: options.env,
    stdio: options.stdio,
    windowsHide: options.windowsHide,
  }) as ChildProcessWithoutNullStreams
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

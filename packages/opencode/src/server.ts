import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/** Exact argv SuperOne uses for serve. */
export const OPENCODE_SERVE_ARGS = ['serve', '--hostname=127.0.0.1', '--port=0'] as const

export interface OpenCodeServerHandle {
  url: string
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }> | null
  close(): Promise<void>
}

const maxServerOutput = 64 * 1024

function appendOutput(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString()
  return next.length <= maxServerOutput ? next : next.slice(-maxServerOutput)
}

export function defaultOpenCodeBinaryPath(): string {
  const filename = process.platform === 'win32' ? 'opencode.exe' : 'opencode'
  const installed = join(homedir(), '.opencode', 'bin', filename)
  return existsSync(installed) ? installed : filename
}

function openCodePath(pathEnv: string | undefined): string {
  const home = homedir()
  const paths = [
    join(home, '.opencode', 'bin'),
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(pathEnv ?? '').split(delimiter),
  ].filter(Boolean)
  return [...new Set(paths)].join(delimiter)
}

function signalChild(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  try {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal)
  } catch {
    /* already gone */
  }
}

async function stopChild(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  signalChild(child, 'SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 1500)),
  ])
  if (stopped) return
  signalChild(child, 'SIGKILL')
  await exited.catch(() => undefined)
}

async function waitForServer(
  child: ChildProcessWithoutNullStreams,
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  let output = ''
  return new Promise<string>((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, url?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      signal?.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(url!)
    }
    const onData = (chunk: Buffer) => {
      output = appendOutput(output, chunk)
      const match = output.match(/^opencode server listening.*?\s+(https?:\/\/[^\s]+)/im)
      if (match?.[1]) finish(undefined, match[1])
    }
    const onAbort = () => finish(new Error('OpenCode server startup aborted'))
    const timer = setTimeout(
      () => finish(new Error(`Timed out waiting for OpenCode server: ${output.trim()}`)),
      timeoutMs,
    )
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => finish(error))
    void exited.then(({ code, signal: sig }) =>
      finish(new Error(`OpenCode server exited (${code ?? sig ?? 'unknown'}): ${output.trim()}`)),
    )
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
  })
}

/**
 * Start `opencode serve` or attach to an existing serverUrl.
 * Electron-free — no orphan reaper / desktop logger.
 */
export async function startOpenCodeServer(opts: {
  binaryPath?: string | null
  cwd: string
  env?: Record<string, string>
  serverUrl?: string | null
  timeoutMs?: number
  signal?: AbortSignal
}): Promise<OpenCodeServerHandle> {
  if (opts.serverUrl?.trim()) {
    return {
      url: opts.serverUrl.trim().replace(/\/$/, ''),
      exited: null,
      close: async () => undefined,
    }
  }

  const binary =
    opts.binaryPath?.trim() ||
    process.env.SUPERONE_OPENCODE_BINARY?.trim() ||
    defaultOpenCodeBinaryPath()

  const child = spawn(binary, [...OPENCODE_SERVE_ARGS], {
    cwd: opts.cwd,
    env: {
      ...process.env,
      ...opts.env,
      PATH: openCodePath(opts.env?.PATH ?? process.env.PATH),
      OPENCODE_CONFIG_CONTENT: opts.env?.OPENCODE_CONFIG_CONTENT ?? '{}',
    },
    stdio: 'pipe',
  }) as ChildProcessWithoutNullStreams

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    let settled = false
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      resolve({ code, signal })
    }
    child.once('exit', finish)
    child.once('close', finish)
  })

  try {
    const url = await waitForServer(child, exited, opts.timeoutMs ?? 10_000, opts.signal)
    let closePromise: Promise<void> | null = null
    return {
      url: url.replace(/\/$/, ''),
      exited,
      close: () => {
        closePromise ??= stopChild(child, exited)
        return closePromise
      },
    }
  } catch (error) {
    await stopChild(child, exited)
    throw error instanceof Error ? error : new Error(String(error))
  }
}

/**
 * True when an **explicit** OpenCode binary is configured (opts or
 * SUPERONE_OPENCODE_BINARY) and exists on disk.
 * Does not auto-enable on a silent `~/.opencode` install — node production
 * must opt in so CI/lab without intent stay on the simulated runner.
 */
export function isOpenCodeBinaryRunnable(binaryPath?: string | null): boolean {
  const fromEnv = process.env.SUPERONE_OPENCODE_BINARY?.trim()
  const candidate = binaryPath?.trim() || fromEnv
  if (!candidate) return false
  return existsSync(candidate)
}

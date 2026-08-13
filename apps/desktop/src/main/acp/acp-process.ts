import { spawn, type ChildProcess } from 'child_process'
import { Readable, Writable } from 'stream'
import type { Stream } from '@agentclientprotocol/sdk'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import log from '../logger'
import { buildSafeEnv } from '../spawn-env'
import type { ResolvedAcpLaunch } from './agent-catalog'

let killEscalateMs = 1500

/** Test hook: shorten SIGTERM→SIGKILL grace so unit tests do not sleep 1.5s. */
export function setAcpKillEscalateMsForTests(ms: number | null): void {
  killEscalateMs = ms == null ? 1500 : ms
}

export interface AcpProcessHandle {
  child: ChildProcess
  stream: Stream
  /** SIGTERM, then SIGKILL if still alive after a short grace period. */
  kill: () => Promise<void>
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>
}

function signalProcess(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  try {
    child.kill(signal)
  } catch {
    /* already gone */
  }
}

async function stopProcess(
  child: ChildProcess,
  closed: Promise<unknown>,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  signalProcess(child, 'SIGTERM')
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), killEscalateMs)),
  ])
  if (stopped) return
  signalProcess(child, 'SIGKILL')
  await closed.catch(() => undefined)
}

export function spawnAcpProcess(launch: ResolvedAcpLaunch): AcpProcessHandle {
  const env = buildSafeEnv(launch.env)
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true,
  })

  const stdin = child.stdin
  const stdout = child.stdout
  if (!stdin || !stdout) {
    void stopProcess(child, Promise.resolve())
    throw new Error(`Failed to open stdio for ACP agent: ${launch.command}`)
  }

  const stderrChunks: string[] = []
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrChunks.push(chunk)
    log.debug('[acp-process] stderr:', chunk.slice(0, 500))
  })

  const output = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const input = Readable.toWeb(stdout) as ReadableStream<Uint8Array>
  const stream = ndJsonStream(output, input)

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal, stderr: stderrChunks.join('') })
    })
  })

  child.once('error', (err) => {
    log.warn('[acp-process] spawn error:', err)
  })

  let killPromise: Promise<void> | null = null

  return {
    child,
    stream,
    kill: () => {
      killPromise ??= stopProcess(child, closed)
      return killPromise
    },
    closed,
  }
}

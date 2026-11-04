import { spawn, type ChildProcess } from 'child_process'
import { PassThrough, Readable, Writable } from 'stream'
import type { Stream } from '@agentclientprotocol/sdk'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import log from '../logger'
import { sanitizeEnv } from '../spawn-env'
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

export interface SpawnAcpProcessOptions {
  baseEnv?: NodeJS.ProcessEnv
  onStdoutLine?: (line: string) => boolean
  onStderrData?: (chunk: string) => void
  onExit?: () => void
}

function createFilteredStdout(
  stdout: NodeJS.ReadableStream,
  onStdoutLine: (line: string) => boolean,
): NodeJS.ReadableStream {
  const pass = new PassThrough()
  let remainder = ''
  stdout.on('data', (chunk: Buffer | string) => {
    remainder += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    let nl = remainder.indexOf('\n')
    while (nl >= 0) {
      const line = remainder.slice(0, nl)
      remainder = remainder.slice(nl + 1)
      if (!onStdoutLine(line)) {
        pass.write(`${line}\n`)
      }
      nl = remainder.indexOf('\n')
    }
  })
  stdout.once('end', () => {
    if (remainder.length > 0 && !onStdoutLine(remainder)) {
      pass.write(remainder)
    }
    pass.end()
  })
  stdout.once('error', (err) => pass.destroy(err))
  return pass
}

export function spawnAcpProcess(
  launch: ResolvedAcpLaunch,
  options?: SpawnAcpProcessOptions,
): AcpProcessHandle {
  const env = sanitizeEnv(options?.baseEnv ?? process.env, launch.env)
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && !/\.(exe|par)$/i.test(launch.command),
    windowsHide: true,
  })

  const stdin = child.stdin
  const stdout = child.stdout
  if (!stdin || !stdout) {
    options?.onExit?.()
    void stopProcess(child, Promise.resolve())
    throw new Error(`Failed to open stdio for ACP agent: ${launch.command}`)
  }

  const stderrChunks: string[] = []
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk: string) => {
    stderrChunks.push(chunk)
    options?.onStderrData?.(chunk)
    log.debug('[acp-process] stderr:', chunk.slice(0, 500))
  })

  const effectiveStdout = options?.onStdoutLine
    ? createFilteredStdout(stdout, options.onStdoutLine)
    : stdout

  const output = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const input = Readable.toWeb(effectiveStdout as Readable) as ReadableStream<Uint8Array>
  const stream = ndJsonStream(output, input)

  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>((resolve) => {
    child.once('exit', (code, signal) => {
      options?.onExit?.()
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

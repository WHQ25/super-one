import { spawn, type ChildProcess } from 'node:child_process'
import { Readable, Writable } from 'node:stream'
import { ndJsonStream, type Stream } from '@agentclientprotocol/sdk'

const KILL_ESCALATE_MS = 1500

export interface AcpLaunch {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  agentId?: string
}

export interface AcpProcessHandle {
  child: ChildProcess
  stream: Stream
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

async function stopProcess(child: ChildProcess, closed: Promise<unknown>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  signalProcess(child, 'SIGTERM')
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), KILL_ESCALATE_MS)),
  ])
  if (stopped) return
  signalProcess(child, 'SIGKILL')
  await closed.catch(() => undefined)
}

/** Spawn an ACP agent process with NDJSON stdio (electron-free). */
export function spawnAcpProcess(launch: AcpLaunch): AcpProcessHandle {
  const child = spawn(launch.command, launch.args ?? [], {
    cwd: launch.cwd || process.cwd(),
    env: { ...process.env, ...launch.env },
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
  })

  const output = Writable.toWeb(stdin) as WritableStream<Uint8Array>
  const input = Readable.toWeb(stdout) as ReadableStream<Uint8Array>
  const stream = ndJsonStream(output, input)

  const closed = new Promise<{
    code: number | null
    signal: NodeJS.Signals | null
    stderr: string
  }>((resolve) => {
    child.once('exit', (code, signal) => {
      resolve({ code, signal, stderr: stderrChunks.join('') })
    })
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

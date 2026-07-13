import { spawn, type ChildProcess } from 'child_process'
import { Readable, Writable } from 'stream'
import type { Stream } from '@agentclientprotocol/sdk'
import { ndJsonStream } from '@agentclientprotocol/sdk'
import log from '../logger'
import type { ResolvedAcpLaunch } from './agent-catalog'

export interface AcpProcessHandle {
  child: ChildProcess
  stream: Stream
  kill: () => void
  closed: Promise<{ code: number | null; signal: NodeJS.Signals | null; stderr: string }>
}

export function spawnAcpProcess(launch: ResolvedAcpLaunch): AcpProcessHandle {
  const env = { ...process.env, ...launch.env } as NodeJS.ProcessEnv
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
    child.kill()
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

  return {
    child,
    stream,
    kill: () => {
      if (!child.killed) {
        try { child.kill() } catch { /* ignore */ }
      }
    },
    closed,
  }
}

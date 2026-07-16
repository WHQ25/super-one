import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { RequestError } from '@agentclientprotocol/sdk'
import type {
  CreateTerminalRequest,
  CreateTerminalResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
} from '@agentclientprotocol/sdk'
import { isPathInsideRoot } from './acp-fs'

const DEFAULT_OUTPUT_BYTE_LIMIT = 1024 * 1024

export interface AcpTerminalOutputListener {
  (info: { terminalId: string; toolUseId?: string; content: string; finished: boolean }): void
}

export interface AcpTerminalManagerOptions {
  projectPath: string
  allowedRoots?: string[]
  onOutput?: AcpTerminalOutputListener
}

interface TerminalRecord {
  id: string
  sessionId: string
  command: string
  args: string[]
  child: ChildProcess | null
  output: string
  truncated: boolean
  outputByteLimit: number
  exitCode: number | null
  signal: string | null
  exited: boolean
  released: boolean
  toolUseId?: string
  waiters: Array<(status: { exitCode: number | null; signal: string | null }) => void>
}

function truncateFromStart(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes <= maxBytes) return { text, truncated: false }
  let cut = bytes - maxBytes
  // Walk forward to a valid UTF-8 / character boundary
  const buf = Buffer.from(text, 'utf8')
  while (cut < buf.length && (buf[cut]! & 0xc0) === 0x80) cut++
  return { text: buf.subarray(cut).toString('utf8'), truncated: true }
}

function appendOutput(rec: TerminalRecord, chunk: string): void {
  if (!chunk) return
  const next = rec.output + chunk
  const { text, truncated } = truncateFromStart(next, rec.outputByteLimit)
  rec.output = text
  if (truncated) rec.truncated = true
}

export class AcpTerminalManager {
  private terminals = new Map<string, TerminalRecord>()
  private readonly projectPath: string
  private readonly allowedRoots: string[]
  private readonly onOutput?: AcpTerminalOutputListener

  constructor(opts: AcpTerminalManagerOptions) {
    this.projectPath = opts.projectPath
    this.allowedRoots = opts.allowedRoots?.length ? opts.allowedRoots : [opts.projectPath]
    this.onOutput = opts.onOutput
  }

  create(params: CreateTerminalRequest): CreateTerminalResponse {
    if (!params.command || typeof params.command !== 'string') {
      throw RequestError.invalidParams({}, 'command is required')
    }
    const cwd = params.cwd
      ? (isPathInsideRoot(params.cwd, this.projectPath) || this.allowedRoots.some((r) => isPathInsideRoot(params.cwd!, r))
        ? params.cwd
        : (() => { throw RequestError.invalidParams({ cwd: params.cwd }, 'cwd outside allowed roots') })())
      : this.projectPath

    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const item of params.env ?? []) {
      if (item?.name) env[item.name] = item.value ?? ''
    }

    const id = `term_${randomBytes(6).toString('hex')}`
    const args = Array.isArray(params.args) ? params.args.map(String) : []
    const limit = typeof params.outputByteLimit === 'number' && params.outputByteLimit > 0
      ? params.outputByteLimit
      : DEFAULT_OUTPUT_BYTE_LIMIT

    const rec: TerminalRecord = {
      id,
      sessionId: params.sessionId,
      command: params.command,
      args,
      child: null,
      output: '',
      truncated: false,
      outputByteLimit: limit,
      exitCode: null,
      signal: null,
      exited: false,
      released: false,
      waiters: [],
    }
    this.terminals.set(id, rec)

    let child: ChildProcess
    try {
      child = spawn(params.command, args, {
        cwd,
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (err) {
      this.terminals.delete(id)
      throw RequestError.internalError(
        { error: err instanceof Error ? err.message : String(err) },
        'Failed to spawn terminal',
      )
    }

    rec.child = child

    const onData = (buf: Buffer) => {
      if (rec.released) return
      appendOutput(rec, buf.toString('utf8'))
      this.emitOutput(rec, false)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', onData)
    child.on('error', (err) => {
      appendOutput(rec, `\n[spawn error] ${err.message}\n`)
      this.finish(rec, 1, null)
    })
    child.on('close', (code, signal) => {
      this.finish(rec, code, signal)
    })

    return { terminalId: id }
  }

  output(params: TerminalOutputRequest): TerminalOutputResponse {
    const rec = this.require(params.terminalId)
    const result: TerminalOutputResponse = {
      output: rec.output,
      truncated: rec.truncated,
    }
    if (rec.exited) {
      result.exitStatus = {
        exitCode: rec.exitCode,
        signal: rec.signal,
      }
    }
    return result
  }

  waitForExit(params: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse> {
    const rec = this.require(params.terminalId)
    if (rec.exited) {
      return Promise.resolve({ exitCode: rec.exitCode, signal: rec.signal })
    }
    return new Promise((resolve) => {
      rec.waiters.push(resolve)
    })
  }

  kill(params: KillTerminalRequest): KillTerminalResponse {
    const rec = this.require(params.terminalId)
    if (!rec.exited && rec.child && !rec.child.killed) {
      try { rec.child.kill('SIGTERM') } catch { /* ignore */ }
    }
    return {}
  }

  release(params: ReleaseTerminalRequest): ReleaseTerminalResponse {
    const rec = this.terminals.get(params.terminalId)
    if (!rec || rec.released) {
      throw RequestError.invalidParams({ terminalId: params.terminalId }, 'Unknown terminal')
    }
    if (!rec.exited && rec.child && !rec.child.killed) {
      try { rec.child.kill('SIGTERM') } catch { /* ignore */ }
    }
    rec.released = true
    rec.child = null
    this.terminals.delete(params.terminalId)
    return {}
  }

  bindTool(terminalId: string, toolUseId: string): void {
    const rec = this.terminals.get(terminalId)
    if (!rec || rec.released) return
    rec.toolUseId = toolUseId
    if (rec.output) this.emitOutput(rec, rec.exited)
  }

  getCommandLine(terminalId: string): string | undefined {
    const rec = this.terminals.get(terminalId)
    if (!rec) return undefined
    return [rec.command, ...rec.args].join(' ')
  }

  getOutput(terminalId: string): string | undefined {
    return this.terminals.get(terminalId)?.output
  }

  dispose(): void {
    for (const id of [...this.terminals.keys()]) {
      try {
        this.release({ sessionId: this.terminals.get(id)?.sessionId ?? '', terminalId: id })
      } catch { /* ignore */ }
    }
    this.terminals.clear()
  }

  private require(terminalId: string): TerminalRecord {
    const rec = this.terminals.get(terminalId)
    if (!rec || rec.released) {
      throw RequestError.invalidParams({ terminalId }, 'Unknown terminal')
    }
    return rec
  }

  private finish(
    rec: TerminalRecord,
    code: number | null,
    signal: NodeJS.Signals | string | null,
  ): void {
    if (rec.exited) return
    rec.exited = true
    rec.exitCode = code
    rec.signal = signal == null ? null : String(signal)
    rec.child = null
    this.emitOutput(rec, true)
    const waiters = rec.waiters.splice(0)
    for (const w of waiters) w({ exitCode: rec.exitCode, signal: rec.signal })
  }

  private emitOutput(rec: TerminalRecord, finished: boolean): void {
    if (!this.onOutput) return
    this.onOutput({
      terminalId: rec.id,
      toolUseId: rec.toolUseId,
      content: rec.output,
      finished,
    })
  }
}

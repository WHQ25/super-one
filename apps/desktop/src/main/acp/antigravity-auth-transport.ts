import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { client, methods, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { resolveDesktopAntigravityLaunch } from '../harness/antigravity-launch'
import { ensureShellPath } from '../shell-path'
import { resolveAcpClientVersion } from './acp-client-info'
import { spawnAcpProcess } from './acp-process'
import {
  extractAntigravityAuthUrlFromStdoutLine,
  extractAntigravityAuthUrlsFromStderrChunk,
  prepareAntigravitySpawnContext,
} from './antigravity-profile'

export interface AntigravityAuthConnection {
  initialize(): Promise<{
    authMethods?: Array<{ id?: string }>
    agentCapabilities?: { auth?: { logout?: unknown } }
  }>
  authenticate(methodId: string): Promise<unknown>
  logout?(): Promise<unknown>
  close(): Promise<void>
}

export interface OpenAntigravityAuthConnectionOptions {
  accountId: string
  onAuthUrl: (rawUrl: string) => void
  customHome?: string
}

export interface AntigravityCodeLoginHandle {
  submit(response: string): void
  completed: Promise<void>
  close(): Promise<void>
}

export interface StartAntigravityCodeLoginOptions {
  accountId: string
  onAuthUrl: (rawUrl: string) => void
  customHome?: string
}

export async function openAntigravityAuthConnection(
  opts: OpenAntigravityAuthConnectionOptions,
): Promise<AntigravityAuthConnection | null> {
  await ensureShellPath()
  const launch = resolveDesktopAntigravityLaunch()
  if (!launch) return null
  const spawnCtx = prepareAntigravitySpawnContext({
    accountId: opts.accountId,
    customHome: opts.customHome,
  })
  const proc = spawnAcpProcess(
    {
      agentId: 'antigravity',
      command: launch.command,
      args: [...launch.args, ...spawnCtx.extraArgs],
      cwd: homedir(),
      env: spawnCtx.extraEnv,
    },
    {
      baseEnv: spawnCtx.baseEnv,
      onStdoutLine: (line) => {
        const url = extractAntigravityAuthUrlFromStdoutLine(line)
        if (url) {
          opts.onAuthUrl(url)
          return true
        }
        return false
      },
      onStderrData: (chunk) => {
        for (const url of extractAntigravityAuthUrlsFromStderrChunk(chunk)) {
          opts.onAuthUrl(url)
        }
      },
      onExit: spawnCtx.cleanup,
    },
  )
  const connection = client({ name: 'superone' }).connect(proc.stream)
  return {
    initialize: () =>
      connection.agent.request(methods.agent.initialize, {
        protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'superone', version: resolveAcpClientVersion() },
        clientCapabilities: {
          fs: { readTextFile: false, writeTextFile: false },
          terminal: false,
        },
      }) as Promise<{
        authMethods?: Array<{ id?: string }>
        agentCapabilities?: { auth?: { logout?: unknown } }
      }>,
    authenticate: (methodId) =>
      connection.agent.request(methods.agent.authenticate, { methodId }),
    logout: () => connection.agent.request('logout' as never, {} as never),
    close: async () => {
      try {
        connection.close()
      } finally {
        await proc.kill()
        spawnCtx.cleanup()
      }
    },
  }
}

export async function startAntigravityCodeLoginProcess(
  opts: StartAntigravityCodeLoginOptions,
): Promise<AntigravityCodeLoginHandle | null> {
  await ensureShellPath()
  const launch = resolveDesktopAntigravityLaunch()
  if (!launch) return null
  const spawnCtx = prepareAntigravitySpawnContext({
    accountId: opts.accountId,
    customHome: opts.customHome,
  })
  const env: NodeJS.ProcessEnv = { ...spawnCtx.baseEnv, ...spawnCtx.extraEnv }
  delete env.DISPLAY
  delete env.WAYLAND_DISPLAY
  const args = [...launch.args, ...spawnCtx.extraArgs, '--login']
  const child = spawn(launch.command, args, {
    cwd: homedir(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdoutBuf = ''
  child.stdout?.on('data', (chunk: Buffer | string) => {
    stdoutBuf += chunk.toString()
    const lines = stdoutBuf.split(/\r?\n/)
    stdoutBuf = lines.pop() ?? ''
    for (const line of lines) {
      const url = extractAntigravityAuthUrlFromStdoutLine(line)
      if (url) opts.onAuthUrl(url)
    }
  })
  child.stderr?.on('data', (chunk: Buffer | string) => {
    for (const url of extractAntigravityAuthUrlsFromStderrChunk(chunk.toString())) {
      opts.onAuthUrl(url)
    }
  })

  const completed = new Promise<void>((resolvePromise, rejectPromise) => {
    child.on('error', (err) => {
      spawnCtx.cleanup()
      rejectPromise(err)
    })
    child.on('close', (code) => {
      if (stdoutBuf.trim()) {
        const url = extractAntigravityAuthUrlFromStdoutLine(stdoutBuf)
        if (url) opts.onAuthUrl(url)
      }
      spawnCtx.cleanup()
      if (code === 0) resolvePromise()
      else rejectPromise(new Error('Antigravity could not finish Google sign-in. Start sign-in again.'))
    })
  })

  return {
    submit: (response: string) => {
      try {
        child.stdin?.write(`${response}\n`)
      } catch {
        void 0
      }
    },
    completed,
    close: async () => {
      try {
        child.kill()
      } catch {
        void 0
      }
      spawnCtx.cleanup()
    },
  }
}

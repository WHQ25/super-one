import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import {
  createOpencodeClient,
  type Agent,
  type Event,
  type FilePartInput,
  type OpencodeClient,
  type PermissionRuleset,
  type ProviderListResponse,
  type TextPartInput,
} from '@opencode-ai/sdk/v2'
import type { EffortLevel, ImageAttachment, ModelOption } from '@superone/shared/agent-types'
import { buildSafeEnv } from '../spawn-env'

export type OpenCodeEvent = Event

export interface OpenCodeClientOptions {
  baseUrl: string
  directory: string
  password?: string
}

const effortLevels = new Set<EffortLevel>(['low', 'medium', 'high', 'xhigh', 'max'])

export function parseOpenCodeModelSlug(model: string | null | undefined): { providerID: string; modelID: string } | null {
  const value = model?.trim()
  if (!value) return null
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { providerID: value.slice(0, separator), modelID: value.slice(separator + 1) }
}

export function parseModels(payload: ProviderListResponse): ModelOption[] {
  const connected = new Set(payload.connected)
  return payload.all
    .filter((provider) => connected.has(provider.id))
    .flatMap((provider) => Object.values(provider.models).map((model) => {
      const supportedEffortLevels = Object.keys(model.variants ?? {})
        .filter((value): value is EffortLevel => effortLevels.has(value as EffortLevel))
      return {
        id: `${provider.id}/${model.id}`,
        name: model.name || model.id,
        description: `${provider.name} ${model.capabilities.reasoning ? 'reasoning' : 'chat'} model`,
        isDefault: payload.default[provider.id] === model.id,
        supportsEffort: supportedEffortLevels.length > 0,
        supportedEffortLevels: supportedEffortLevels.length > 0 ? supportedEffortLevels : undefined,
      }
    }))
}

export class OpenCodeApiError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause ? { cause } : undefined)
    this.name = 'OpenCodeApiError'
  }
}

export class OpenCodeClient {
  readonly sdk: OpencodeClient

  constructor(opts: OpenCodeClientOptions) {
    this.sdk = createOpencodeClient({
      baseUrl: opts.baseUrl.replace(/\/$/, ''),
      directory: opts.directory,
      throwOnError: true,
      ...(opts.password
        ? { headers: { Authorization: `Basic ${Buffer.from(`opencode:${opts.password}`, 'utf8').toString('base64')}` } }
        : {}),
    })
  }

  async providerList(): Promise<ProviderListResponse> {
    const result = await this.sdk.provider.list()
    if (!result.data) throw new OpenCodeApiError('OpenCode provider list was empty')
    return result.data
  }

  async agents(): Promise<Agent[]> {
    const result = await this.sdk.app.agents()
    return result.data ?? []
  }

  async createSession(permission: PermissionRuleset, title?: string): Promise<{ id: string }> {
    const result = await this.sdk.session.create({ title, permission })
    if (!result.data) throw new OpenCodeApiError('OpenCode session was not created')
    return { id: result.data.id }
  }

  async updatePermission(sessionId: string, permission: PermissionRuleset): Promise<void> {
    await this.sdk.session.update({ sessionID: sessionId, permission })
  }

  async promptAsync(sessionId: string, input: {
    text: string
    model?: string
    variant?: string
    agent?: string
    images?: ImageAttachment[]
  }): Promise<void> {
    const parts: TextPartInput[] = input.text ? [{ type: 'text', text: input.text }] : []
    const fileParts: FilePartInput[] = (input.images ?? []).map((image) => ({
      type: 'file',
      mime: image.mimeType,
      filename: image.name,
      url: `data:${image.mimeType};base64,${image.base64}`,
    }))
    const model = parseOpenCodeModelSlug(input.model)
    if (input.model && !model) throw new OpenCodeApiError(`Invalid OpenCode model id: ${input.model}`)
    await this.sdk.session.promptAsync({
      sessionID: sessionId,
      model: model ?? undefined,
      variant: input.variant,
      agent: input.agent,
      parts: [...parts, ...fileParts],
    })
  }

  async abort(sessionId: string): Promise<void> {
    await this.sdk.session.abort({ sessionID: sessionId })
  }

  async permissionReply(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<void> {
    await this.sdk.permission.reply({ requestID: requestId, reply })
  }

  async questionReply(requestId: string, answers: string[][]): Promise<void> {
    await this.sdk.question.reply({ requestID: requestId, answers })
  }

  async questionReject(requestId: string): Promise<void> {
    await this.sdk.question.reject({ requestID: requestId })
  }

  async eventStream(signal: AbortSignal): Promise<AsyncIterable<OpenCodeEvent>> {
    return (await this.sdk.event.subscribe({}, { signal })).stream
  }
}

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

function defaultBinaryPath(): string {
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
    if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {}
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
      if (error) reject(error)
      else resolve(url!)
    }
    const onData = (chunk: Buffer) => {
      output = appendOutput(output, chunk)
      const match = output.match(/^opencode server listening.*?\s+(https?:\/\/[^\s]+)/im)
      if (match?.[1]) finish(undefined, match[1])
    }
    const timer = setTimeout(() => finish(new Error(`Timed out waiting for OpenCode server: ${output.trim()}`)), timeoutMs)
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', (error) => finish(error))
    void exited.then(({ code, signal }) => finish(new Error(`OpenCode server exited (${code ?? signal ?? 'unknown'}): ${output.trim()}`)))
  })
}

export async function startOpenCodeServer(opts: {
  binaryPath?: string
  cwd: string
  env?: Record<string, string>
  serverUrl?: string | null
  timeoutMs?: number
}): Promise<OpenCodeServerHandle> {
  if (opts.serverUrl?.trim()) {
    return { url: opts.serverUrl.trim().replace(/\/$/, ''), exited: null, close: async () => undefined }
  }
  const child = spawn(opts.binaryPath?.trim() || defaultBinaryPath(), ['serve', '--hostname=127.0.0.1', '--port=0'], {
    cwd: opts.cwd,
    env: buildSafeEnv({
      ...opts.env,
      PATH: openCodePath(opts.env?.PATH ?? process.env.PATH),
      OPENCODE_CONFIG_CONTENT: opts.env?.OPENCODE_CONFIG_CONTENT ?? '{}',
    }),
    stdio: 'pipe',
    detached: process.platform !== 'win32',
  })
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
    const url = await waitForServer(child, exited, opts.timeoutMs ?? 10000)
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
    throw new OpenCodeApiError(error instanceof Error ? error.message : String(error), error)
  }
}

export async function probeOpenCodeResources(config: {
  binaryPath?: string
  cwd: string
  env?: Record<string, string>
  serverUrl?: string | null
  serverPassword?: string
}): Promise<{ models: ModelOption[]; agents: Array<{ id: string; name: string; description?: string }> }> {
  const server = await startOpenCodeServer(config)
  try {
    const client = new OpenCodeClient({ baseUrl: server.url, directory: config.cwd, password: config.serverPassword })
    const [providers, agents] = await Promise.all([client.providerList(), client.agents()])
    return {
      models: parseModels(providers),
      agents: agents
        .filter((agent) => !agent.hidden)
        .map((agent) => ({ id: agent.name, name: agent.name, description: agent.description })),
    }
  } finally {
    await server.close()
  }
}

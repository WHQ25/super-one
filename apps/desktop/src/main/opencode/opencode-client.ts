import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import {
  createOpencodeClient,
  type Agent,
  type Command,
  type Event,
  type FilePartInput,
  type Message,
  type McpStatus,
  type McpLocalConfig,
  type McpRemoteConfig,
  type OpencodeClient,
  type Part,
  type PermissionV2Request,
  type PermissionRuleset,
  type ProviderListResponse,
  type QuestionV2Request,
  type SnapshotFileDiff,
  type TextPartInput,
  type Todo,
} from '@opencode-ai/sdk/v2'
import type {
  ContextUsageInfo,
  EffortLevel,
  ImageAttachment,
  McpServerConfig,
  McpServerInfo,
  ModelOption,
  OpenCodeResources,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
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
        contextWindow: model.limit.context,
        supportsEffort: supportedEffortLevels.length > 0,
        supportedEffortLevels: supportedEffortLevels.length > 0 ? supportedEffortLevels : undefined,
      }
    }))
}

export function parseOpenCodeCommands(commands: Command[]): SlashCommandInfo[] {
  return commands.map((command) => ({
    name: command.name.replace(/^\//, ''),
    description: command.description ?? '',
    argumentHint: command.hints.join(' '),
    isSkill: command.source === 'skill',
  }))
}

export function parseOpenCodeAgents(agents: Agent[]): OpenCodeResources['agents'] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== 'subagent')
    .map((agent) => ({ id: agent.name, name: agent.name, description: agent.description }))
}

export function toOpenCodeMcpConfig(config: McpServerConfig): McpLocalConfig | McpRemoteConfig | null {
  if (config.type === 'stdio') {
    if (!config.command?.trim()) return null
    return {
      type: 'local',
      command: [config.command, ...(config.args ?? [])],
      environment: config.env,
      enabled: !config.disabled,
    }
  }
  if (!config.url?.trim()) return null
  return {
    type: 'remote',
    url: config.url,
    headers: config.headers,
    enabled: !config.disabled,
  }
}

const openCodeLocalCommands: SlashCommandInfo[] = [
  { name: 'init', description: 'Create or update project AGENTS.md', argumentHint: '', isSkill: false },
  { name: 'compact', description: 'Compact session context', argumentHint: '', isSkill: false },
]

export function withOpenCodeLocalCommands(commands: SlashCommandInfo[]): SlashCommandInfo[] {
  const seen = new Set(commands.map((command) => command.name.replace(/^\//, '')))
  return [...commands, ...openCodeLocalCommands.filter((command) => !seen.has(command.name))]
}

export function parseOpenCodeMcpStatus(statuses: Record<string, McpStatus>): McpServerInfo[] {
  return Object.entries(statuses).map(([name, value]) => {
    if (value.status === 'connected') return { name, status: 'connected', scope: 'project' }
    if (value.status === 'disabled') return { name, status: 'disabled', scope: 'project' }
    if (value.status === 'failed') return { name, status: 'failed', error: value.error, scope: 'project' }
    return {
      name,
      status: 'needs-auth',
      ...('error' in value ? { error: value.error } : {}),
      scope: 'project',
    }
  })
}

function imageParts(images: ImageAttachment[] | undefined): FilePartInput[] {
  return (images ?? []).map((image) => ({
    type: 'file',
    mime: image.mimeType,
    filename: image.name,
    url: `data:${image.mimeType};base64,${image.base64}`,
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

  async commands(): Promise<Command[]> {
    const result = await this.sdk.command.list()
    return result.data ?? []
  }

  async mcpStatus(): Promise<McpServerInfo[]> {
    const result = await this.sdk.mcp.status()
    return parseOpenCodeMcpStatus(result.data ?? {})
  }

  async addMcp(name: string, config: McpLocalConfig | McpRemoteConfig): Promise<void> {
    await this.sdk.mcp.add({ name, config })
  }

  async connectMcp(name: string): Promise<void> {
    await this.sdk.mcp.connect({ name })
  }

  async disconnectMcp(name: string): Promise<void> {
    await this.sdk.mcp.disconnect({ name })
  }

  async authenticateMcp(name: string): Promise<void> {
    await this.sdk.mcp.auth.authenticate({ name })
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
    const fileParts = imageParts(input.images)
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

  async command(sessionId: string, input: {
    command: string
    arguments?: string
    model?: string
    variant?: string
    agent?: string
    images?: ImageAttachment[]
  }): Promise<void> {
    const parts = imageParts(input.images)
    await this.sdk.session.command({
      sessionID: sessionId,
      command: input.command,
      arguments: input.arguments,
      model: input.model,
      variant: input.variant,
      agent: input.agent,
      parts: parts.length > 0 ? parts : undefined,
    })
  }

  async sessionMessages(sessionId: string): Promise<Array<{ info: Message; parts: Part[] }>> {
    const result = await this.sdk.session.messages({ sessionID: sessionId })
    return result.data ?? []
  }

  async todos(sessionId: string): Promise<Todo[]> {
    const result = await this.sdk.session.todo({ sessionID: sessionId })
    return result.data ?? []
  }

  async pendingInteractions(sessionId: string): Promise<{
    permissions: PermissionV2Request[]
    questions: QuestionV2Request[]
  }> {
    const [permissions, questions] = await Promise.all([
      this.sdk.v2.session.permission.list({ sessionID: sessionId }),
      this.sdk.v2.session.question.list({ sessionID: sessionId }),
    ])
    return {
      permissions: permissions.data?.data ?? [],
      questions: questions.data?.data ?? [],
    }
  }

  private async resolveSessionModel(sessionId: string, model?: string): Promise<{ providerID: string; modelID: string }> {
    const parsed = parseOpenCodeModelSlug(model)
    if (model && !parsed) throw new OpenCodeApiError(`Invalid OpenCode model id: ${model}`)
    if (parsed) return parsed
    const messages = await this.sessionMessages(sessionId)
    const assistant = messages.findLast((message) => message.info.role === 'assistant')
    if (assistant?.info.role === 'assistant') {
      return { providerID: assistant.info.providerID, modelID: assistant.info.modelID }
    }
    const session = await this.sdk.session.get({ sessionID: sessionId })
    const sessionModel = session.data?.model
    if (sessionModel) return { providerID: sessionModel.providerID, modelID: sessionModel.id }
    throw new OpenCodeApiError('OpenCode session has no model to compact')
  }

  async summarize(sessionId: string, model?: string): Promise<void> {
    const resolved = await this.resolveSessionModel(sessionId, model)
    await this.sdk.session.summarize({ sessionID: sessionId, ...resolved, auto: false })
  }

  async initSession(sessionId: string, model?: string): Promise<void> {
    const resolved = await this.resolveSessionModel(sessionId, model)
    await this.sdk.session.init({ sessionID: sessionId, ...resolved })
  }

  async contextUsage(sessionId: string, models: ModelOption[]): Promise<ContextUsageInfo | null> {
    const messages = await this.sessionMessages(sessionId)
    const assistant = messages.findLast((message) => message.info.role === 'assistant')
    if (!assistant || assistant.info.role !== 'assistant') return null
    const info = assistant.info
    const model = `${info.providerID}/${info.modelID}`
    const maxTokens = models.find((candidate) => candidate.id === model)?.contextWindow
    if (!maxTokens) return null
    const categories = [
      { name: 'Input', tokens: info.tokens.input, color: '#22c55e' },
      { name: 'Output', tokens: info.tokens.output, color: '#06b6d4' },
      { name: 'Reasoning', tokens: info.tokens.reasoning, color: '#8b5cf6' },
      { name: 'Cache read', tokens: info.tokens.cache.read, color: '#6366f1' },
      { name: 'Cache write', tokens: info.tokens.cache.write, color: '#f59e0b' },
    ]
    const totalTokens = info.tokens.total
      ?? categories.reduce((total, category) => total + category.tokens, 0)
    return {
      categories,
      totalTokens,
      maxTokens,
      percentage: Math.min(100, (totalTokens / maxTokens) * 100),
      model,
    }
  }

  async diff(sessionId: string, messageId: string): Promise<SnapshotFileDiff[]> {
    const result = await this.sdk.session.diff({ sessionID: sessionId, messageID: messageId })
    return result.data ?? []
  }

  async revert(sessionId: string, messageId: string): Promise<void> {
    await this.sdk.session.revert({ sessionID: sessionId, messageID: messageId })
  }

  async unrevert(sessionId: string): Promise<void> {
    await this.sdk.session.unrevert({ sessionID: sessionId })
  }

  async forkSession(sessionId: string, messageId?: string): Promise<{ id: string; directory: string }> {
    const result = await this.sdk.session.fork({ sessionID: sessionId, messageID: messageId })
    if (!result.data) throw new OpenCodeApiError('OpenCode session fork was empty')
    return { id: result.data.id, directory: result.data.directory }
  }

  async moveSession(sessionId: string, directory: string): Promise<void> {
    await this.sdk.experimental.controlPlane.moveSession({
      sessionID: sessionId,
      destination: { directory },
      moveChanges: false,
    })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sdk.session.delete({ sessionID: sessionId })
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
}): Promise<OpenCodeResources> {
  const server = await startOpenCodeServer(config)
  try {
    const client = new OpenCodeClient({ baseUrl: server.url, directory: config.cwd, password: config.serverPassword })
    const [providers, agents, commands] = await Promise.all([client.providerList(), client.agents(), client.commands()])
    return {
      models: parseModels(providers),
      agents: parseOpenCodeAgents(agents),
      commands: withOpenCodeLocalCommands(parseOpenCodeCommands(commands)),
    }
  } finally {
    await server.close()
  }
}

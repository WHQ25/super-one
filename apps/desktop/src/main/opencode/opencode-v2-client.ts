import { realpathSync } from 'fs'
import type {
  McpServerConfig,
  McpServerInfo,
  ModelOption,
  OpenCodeResources,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import { OpenCodeApiError, openCodeAuthorization, openCodeEffortLevels } from './opencode-client'
import type {
  OpenCodeV2Agent,
  OpenCodeV2Command,
  OpenCodeV2Event,
  OpenCodeV2FileDiff,
  OpenCodeV2Form,
  OpenCodeV2FormValue,
  OpenCodeV2McpConfig,
  OpenCodeV2McpServer,
  OpenCodeV2Message,
  OpenCodeV2Model,
  OpenCodeV2ModelRef,
  OpenCodeV2PermissionRequest,
  OpenCodeV2PermissionRule,
  OpenCodeV2Provider,
  OpenCodeV2Session,
} from './opencode-v2-types'

export interface OpenCodeV2ClientOptions {
  baseUrl: string
  directory: string
  password?: string
}

type Query = Record<string, string | undefined>

/**
 * 2.x records no file snapshots for a session located at a symlinked path, so
 * locations are resolved. A path missing locally (a remote `serverUrl`) is kept.
 */
function canonicalDirectory(directory: string): string {
  try {
    return realpathSync.native(directory)
  } catch {
    return directory
  }
}

/**
 * Catalogs load per location on first use: the first request for a directory
 * answers empty lists (models also wait for providers after `serve` starts).
 */
const CATALOG_SETTLE_TIMEOUT_MS = 3000
const CATALOG_SETTLE_POLL_MS = 200

async function settledList<T>(load: () => Promise<T[]>): Promise<T[]> {
  const deadline = Date.now() + CATALOG_SETTLE_TIMEOUT_MS
  for (;;) {
    const items = await load()
    if (items.length > 0 || Date.now() >= deadline) return items
    await new Promise((resolve) => setTimeout(resolve, CATALOG_SETTLE_POLL_MS))
  }
}

export class OpenCodeV2Client {
  private readonly baseUrl: string
  private readonly directory: string
  private readonly headers: Record<string, string>

  constructor(opts: OpenCodeV2ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '')
    this.directory = canonicalDirectory(opts.directory)
    this.headers = opts.password ? { Authorization: openCodeAuthorization(opts.password) } : {}
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    opts: { query?: Query; body?: unknown; located?: boolean } = {},
  ): Promise<T> {
    const params = new URLSearchParams()
    if (opts.located) params.set('location[directory]', this.directory)
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) params.set(key, value)
    }
    const search = params.size > 0 ? `?${params}` : ''
    const response = await fetch(`${this.baseUrl}${path}${search}`, {
      method,
      headers: {
        ...this.headers,
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    })
    const text = await response.text()
    if (!response.ok) {
      let message = text
      try {
        const body = JSON.parse(text) as { message?: unknown }
        if (typeof body.message === 'string' && body.message) message = body.message
      } catch {}
      throw new OpenCodeApiError(`OpenCode ${method} ${path} failed (${response.status}): ${message}`)
    }
    return (text ? JSON.parse(text) : undefined) as T
  }

  private async data<T>(...args: Parameters<OpenCodeV2Client['request']>): Promise<T> {
    return (await this.request<{ data: T }>(...args)).data
  }

  models(): Promise<OpenCodeV2Model[]> {
    return settledList(() => this.data('GET', '/api/model', { located: true }))
  }

  defaultModel(): Promise<OpenCodeV2Model | null> {
    return this.data('GET', '/api/model/default', { located: true })
  }

  providers(): Promise<OpenCodeV2Provider[]> {
    return this.data('GET', '/api/provider', { located: true })
  }

  agents(): Promise<OpenCodeV2Agent[]> {
    return this.data('GET', '/api/agent', { located: true })
  }

  commands(): Promise<OpenCodeV2Command[]> {
    return this.data('GET', '/api/command', { located: true })
  }

  /**
   * Models, agents and commands in SuperOne's shapes. Built-in agents always
   * exist, so a non-empty agent list marks the location's catalogs as loaded.
   */
  async resources(): Promise<OpenCodeResources> {
    const agents = await settledList(() => this.agents())
    const [models, defaultModel, providers, commands] = await Promise.all([
      this.models(),
      this.defaultModel(),
      this.providers(),
      this.commands(),
    ])
    return {
      models: parseOpenCodeV2Models(models, defaultModel, providers),
      agents: parseOpenCodeV2Agents(agents),
      commands: parseOpenCodeV2Commands(commands),
    }
  }

  async mcpStatus(): Promise<McpServerInfo[]> {
    return parseOpenCodeV2McpStatus(await this.data('GET', '/api/mcp', { located: true }))
  }

  async putMcp(name: string, config: OpenCodeV2McpConfig): Promise<void> {
    await this.request('PUT', `/api/experimental/mcp/${encodeURIComponent(name)}`, { located: true, body: { config } })
  }

  async connectMcp(name: string): Promise<void> {
    await this.request('POST', `/api/experimental/mcp/${encodeURIComponent(name)}/connect`, { located: true })
  }

  async disconnectMcp(name: string): Promise<void> {
    await this.request('POST', `/api/experimental/mcp/${encodeURIComponent(name)}/disconnect`, { located: true })
  }

  createSession(permissions: OpenCodeV2PermissionRule[]): Promise<OpenCodeV2Session> {
    return this.data('POST', '/api/session', { body: { location: { directory: this.directory }, permissions } })
  }

  getSession(sessionId: string): Promise<OpenCodeV2Session> {
    return this.data('GET', `/api/session/${sessionId}`)
  }

  async updateSession(sessionId: string, patch: { title?: string; permissions?: OpenCodeV2PermissionRule[] }): Promise<void> {
    await this.request('PATCH', `/api/session/${sessionId}`, { body: patch })
  }

  async switchModel(sessionId: string, model: OpenCodeV2ModelRef): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/model`, { body: { model } })
  }

  async switchAgent(sessionId: string, agent: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/agent`, { body: { agent } })
  }

  /** Session-scoped system instructions, keyed so a repeat put replaces the entry. */
  async putInstruction(sessionId: string, key: string, value: string): Promise<void> {
    await this.request('PUT', `/api/experimental/session/${sessionId}/instructions/entries/${encodeURIComponent(key)}`, {
      body: { value },
    })
  }

  async prompt(sessionId: string, input: { text: string; files: Array<{ uri: string; name: string }> }): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/prompt`, {
      body: { text: input.text, ...(input.files.length > 0 ? { files: input.files } : {}) },
    })
  }

  async command(sessionId: string, input: { name: string; text: string; files: Array<{ uri: string; name: string }> }): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/command`, {
      body: { name: input.name, text: input.text, ...(input.files.length > 0 ? { files: input.files } : {}) },
    })
  }

  async shell(sessionId: string, command: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/shell`, { body: { command } })
  }

  async compact(sessionId: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/compact`, { body: {} })
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/interrupt`)
  }

  permissions(sessionId: string): Promise<OpenCodeV2PermissionRequest[]> {
    return this.data('GET', `/api/session/${sessionId}/permission`)
  }

  async permissionReply(sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/permission/${requestId}/reply`, { body: { decision } })
  }

  forms(sessionId: string): Promise<OpenCodeV2Form[]> {
    return this.data('GET', `/api/session/${sessionId}/form`)
  }

  async formReply(sessionId: string, formId: string, answer: Record<string, OpenCodeV2FormValue>): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/form/${formId}/reply`, { body: { answer } })
  }

  async formCancel(sessionId: string, formId: string): Promise<void> {
    await this.request('DELETE', `/api/session/${sessionId}/form/${formId}`)
  }

  messages(sessionId: string, query: { type?: string; order?: 'asc' | 'desc'; limit?: number }): Promise<OpenCodeV2Message[]> {
    return this.data('GET', `/api/session/${sessionId}/message`, {
      query: { type: query.type, order: query.order, limit: query.limit?.toString() },
    })
  }

  /** File changes from the turn of `from` through the turn of `to`. */
  diff(sessionId: string, from: string, to?: string): Promise<OpenCodeV2FileDiff[]> {
    return this.data('GET', `/api/session/${sessionId}/diff`, { query: { from, to } })
  }

  /** Reversible: hides history from `messageId` on and restores its files. */
  async revertStage(sessionId: string, messageId: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/revert/stage`, { body: { messageID: messageId, files: true } })
  }

  async revertClear(sessionId: string): Promise<void> {
    await this.request('DELETE', `/api/session/${sessionId}/revert`)
  }

  /** Copies history before `messageId` (all of it when omitted) into a new session. */
  async forkSession(sessionId: string, messageId?: string): Promise<{ id: string; directory: string }> {
    const session = await this.data<OpenCodeV2Session>('POST', `/api/session/${sessionId}/fork`, {
      body: messageId ? { before: messageId } : {},
    })
    return { id: session.id, directory: session.location.directory }
  }

  async moveSession(sessionId: string, directory: string): Promise<void> {
    await this.request('POST', `/api/session/${sessionId}/move`, { body: { directory: canonicalDirectory(directory) } })
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.request('DELETE', `/api/session/${sessionId}`)
  }

  /** Resolves once subscribed, so events from a following request are not missed. */
  async eventStream(signal: AbortSignal): Promise<AsyncIterable<OpenCodeV2Event>> {
    const response = await fetch(`${this.baseUrl}/api/event`, {
      headers: { ...this.headers, accept: 'text/event-stream' },
      signal,
    })
    if (!response.ok || !response.body) {
      throw new OpenCodeApiError(`OpenCode event stream failed (${response.status})`)
    }
    return parseServerSentEvents(response.body)
  }
}

async function* parseServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<OpenCodeV2Event> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    // Normalize on the whole buffer: a CRLF may be split across chunks.
    buffer = `${buffer}${decoder.decode(chunk, { stream: true })}`.replace(/\r\n/g, '\n')
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield JSON.parse(data) as OpenCodeV2Event
    }
  }
}

export function parseOpenCodeV2Models(
  models: OpenCodeV2Model[],
  defaultModel: OpenCodeV2Model | null,
  providers: OpenCodeV2Provider[],
): ModelOption[] {
  const providerNames = new Map(providers.map((provider) => [provider.id, provider.name]))
  return models
    .filter((model) => model.enabled)
    .map((model) => {
      const supportedEffortLevels = openCodeEffortLevels(model.variants.map((variant) => variant.id))
      return {
        id: `${model.providerID}/${model.id}`,
        name: model.name || model.id,
        description: `${providerNames.get(model.providerID) ?? model.providerID} model`,
        isDefault: defaultModel?.providerID === model.providerID && defaultModel.id === model.id,
        contextWindow: model.limit.context,
        supportsEffort: supportedEffortLevels.length > 0,
        supportedEffortLevels: supportedEffortLevels.length > 0 ? supportedEffortLevels : undefined,
      }
    })
}

export function parseOpenCodeV2Agents(agents: OpenCodeV2Agent[]): OpenCodeResources['agents'] {
  return agents
    .filter((agent) => !agent.hidden && agent.mode !== 'subagent')
    .map((agent) => ({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      modelId: agent.model ? `${agent.model.providerID}/${agent.model.id}` : undefined,
    }))
}

export function parseOpenCodeV2Commands(commands: OpenCodeV2Command[]): SlashCommandInfo[] {
  return commands.map((command) => ({
    name: command.name.replace(/^\//, ''),
    description: command.description ?? '',
    argumentHint: '',
    isSkill: false,
  }))
}

export function parseOpenCodeV2McpStatus(servers: OpenCodeV2McpServer[]): McpServerInfo[] {
  return servers.map(({ name, status }) => {
    const base = { name, scope: 'project' }
    if (status.status === 'failed') return { ...base, status: 'failed', error: status.error }
    if (status.status === 'needs_auth') return { ...base, status: 'needs-auth', error: status.error }
    return { ...base, status: status.status }
  })
}

/**
 * SuperOne host tools are registered with `codemode: false`. In code mode the
 * model reaches MCP tools through one `execute` tool whose input is a script, so
 * neither the chat tool blocks nor the `terminal_tabs` host gate would see the
 * tool's own name and arguments.
 */
export function toOpenCodeV2McpConfig(config: McpServerConfig, opts: { host?: boolean } = {}): OpenCodeV2McpConfig | null {
  const hostFlags = opts.host ? { codemode: false } : {}
  if (config.type === 'stdio') {
    if (!config.command?.trim()) return null
    return {
      type: 'local',
      command: [config.command, ...(config.args ?? [])],
      environment: config.env,
      disabled: Boolean(config.disabled),
      ...hostFlags,
    }
  }
  if (!config.url?.trim()) return null
  return { type: 'remote', url: config.url, headers: config.headers, disabled: Boolean(config.disabled), ...hostFlags }
}

/** 2.x renames rule fields: `permission/pattern/action` → `action/resource/effect`. */
export function toOpenCodeV2Ruleset(rules: PermissionRuleset): OpenCodeV2PermissionRule[] {
  return rules.map((rule) => ({ action: rule.permission, resource: rule.pattern, effect: rule.action }))
}

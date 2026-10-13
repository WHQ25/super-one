import { realpathSync } from 'fs'
import type { MessageListInput, OpenCodeClient, SessionPromptInput, IntegrationOauthConnectInput } from '@opencode/client'
import type {
  McpServerConfig,
  McpServerInfo,
  ModelOption,
  OpenCodeResources,
  SlashCommandInfo,
} from '@superone/shared/agent-types'
import type { PermissionRuleset } from '@opencode-ai/sdk/v2'
import { OpenCodeApiError, openCodeAuthorization, openCodeEffortLevels } from './client-common'
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
  OpenCodeV2Skill,
  OpenCodeV2Inbox,
} from './opencode-v2-types'

export interface OpenCodeV2ClientOptions {
  baseUrl: string
  directory: string
  password?: string
  signal?: AbortSignal
}

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

function boundedReadSignal(signal?: AbortSignal, timeoutMs = 5000) {
  return AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)])
}

async function settledList<T>(load: () => Promise<T[]>): Promise<T[]> {
  const deadline = Date.now() + CATALOG_SETTLE_TIMEOUT_MS
  for (;;) {
    const items = await load()
    if (items.length > 0 || Date.now() >= deadline) return items
    await new Promise((resolve) => setTimeout(resolve, CATALOG_SETTLE_POLL_MS))
  }
}

/** SuperOne conversions above the official Promise client; loaded only for V2. */
export class OpenCodeV2Client {
  private sdk: Promise<OpenCodeClient>
  private readonly location: { directory: string }
  get directory() { return this.location.directory }

  constructor(private readonly opts: OpenCodeV2ClientOptions) {
    if (typeof Promise.withResolvers !== 'function') throw new Error('OpenCode V2 client requires Node.js 22 or newer')
    this.location = { directory: canonicalDirectory(opts.directory) }
    this.sdk = this.makeClient(opts)
  }
  private makeClient(opts: OpenCodeV2ClientOptions) {
    return import('@opencode/client').then(({ OpenCode }) => OpenCode.make({
      baseUrl: opts.baseUrl,
      headers: opts.password ? { Authorization: openCodeAuthorization(opts.password) } : {},
      ...(opts.signal ? { fetch: (url: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(url, {
        ...init, signal: AbortSignal.any([opts.signal!, ...(init?.signal ? [init.signal] : [])]),
      }) } : {}),
    }))
  }
  setEndpoint(url: string, password: string) {
    this.opts.baseUrl = url; this.opts.password = password
    this.sdk = this.makeClient({ ...this.opts })
  }

  private async call<T>(run: (sdk: OpenCodeClient) => Promise<T>): Promise<T> {
    try {
      return await run(await this.sdk)
    } catch (error) {
      throw new OpenCodeApiError(error instanceof Error ? error.message : String(error), error)
    }
  }

  models(): Promise<OpenCodeV2Model[]> {
    return settledList(() => this.call(async (sdk) => (await sdk.model.list({ location: this.location })).data))
  }

  defaultModel(): Promise<OpenCodeV2Model | null> {
    return this.call(async (sdk) => (await sdk.model.default({ location: this.location })).data)
  }

  providers(): Promise<OpenCodeV2Provider[]> {
    return this.call(async (sdk) => (await sdk.provider.list({ location: this.location })).data)
  }

  agents(): Promise<OpenCodeV2Agent[]> {
    return this.call(async (sdk) => (await sdk.agent.list({ location: this.location })).data)
  }

  commands(): Promise<OpenCodeV2Command[]> {
    return this.call(async (sdk) => (await sdk.command.list({ location: this.location })).data)
  }

  skills(): Promise<OpenCodeV2Skill[]> {
    return this.call(async (sdk) => (await sdk.skill.list({ location: this.location })).data)
  }

  reloadLocation(assertControl?: () => void): Promise<void> { return this.call((sdk) => { assertControl?.(); return sdk.location.reload() }) }

  nativeMcpServers(signal?: AbortSignal) { return this.call(async (sdk) => (await sdk.mcp.list({ location: this.location }, { signal })).data) }
  integration(id: string, signal?: AbortSignal) { return this.call(async (sdk) => (await sdk.integration.get({ integrationID: id, location: this.location }, { signal })).data) }
  startOAuth(id: string, methodID: string, answer: IntegrationOauthConnectInput['answer'], signal?: AbortSignal, assertControl?: () => void) {
    return this.call(async (sdk) => { assertControl?.(); return (await sdk.integration.oauth.connect({ integrationID: id, methodID, answer, location: this.location }, { signal })).data })
  }
  oauthStatus(id: string, attemptID: string, signal?: AbortSignal) {
    return this.call(async (sdk) => (await sdk.integration.oauth.status({ integrationID: id, attemptID, location: this.location }, { signal })).data)
  }
  completeOAuth(id: string, attemptID: string, code: string, signal?: AbortSignal, assertControl?: () => void) {
    return this.call((sdk) => { assertControl?.(); return sdk.integration.oauth.complete({ integrationID: id, attemptID, code, location: this.location }, { signal }) })
  }
  cancelOAuth(id: string, attemptID: string) {
    return this.call((sdk) => sdk.integration.oauth.cancel({ integrationID: id, attemptID, location: this.location }, { signal: AbortSignal.timeout(3000) }))
  }

  inbox(sessionID: string, signal?: AbortSignal): Promise<OpenCodeV2Inbox[]> {
    const bounded = boundedReadSignal(signal)
    return this.call((sdk) => sdk.session.inbox.list({ sessionID }, { signal: bounded }))
  }
  cancelInbox(sessionID: string, inboxID: string, assertControl?: () => void) {
    return this.call((sdk) => { assertControl?.(); return sdk.session.inbox.cancel({ sessionID, inboxID }) })
  }
  updateInbox(sessionID: string, inboxID: string, delivery: 'steer' | 'queue', assertControl?: () => void) {
    return this.call((sdk) => { assertControl?.(); return sdk.session.inbox.update({ sessionID, inboxID, delivery }) })
  }

  /** Finite replay ends at a captured watermark; never expose a partial replay. */
  async sessionLog(sessionID: string, after: number, signal: AbortSignal) {
    const sdk = await this.sdk
    const requestSignal = boundedReadSignal(signal, 10000)
    const events: OpenCodeV2Event[] = []
    for await (const item of sdk.session.log({ sessionID, after, follow: false }, { signal: requestSignal })) {
      if (item.type === 'log.synced') {
        if (item.aggregateID !== sessionID || !Number.isSafeInteger(item.seq ?? 0) || (item.seq ?? 0) < 0) throw new Error('Invalid OpenCode log watermark')
        return { events, cursor: item.seq ?? 0 }
      }
      if (item.durable.aggregateID !== sessionID) throw new Error('OpenCode log returned another session')
      if (!Number.isSafeInteger(item.durable.seq) || item.durable.seq <= after) throw new Error('Invalid OpenCode log sequence')
      if (events.length >= 20000) throw new Error('OpenCode replay exceeded its event limit')
      events.push(item)
    }
    throw new Error('OpenCode log closed without a synchronization marker')
  }

  async messagesSince(sessionID: string, boundary: string | undefined, signal: AbortSignal): Promise<OpenCodeV2Message[]> {
    const result: OpenCodeV2Message[] = []
    const bounded = boundedReadSignal(signal, 10000)
    let cursor: string | undefined
    for (let page = 0; page < 100; page++) {
      const loaded = await this.call((sdk) => sdk.message.list({ sessionID, limit: 100, ...(cursor ? { cursor } : { order: 'desc' }) }, { signal: bounded }))
      for (const message of loaded.data) {
        if (message.id === boundary) return result.reverse()
        result.push(message)
      }
      if (!loaded.cursor.next) {
        if (boundary) throw new Error('OpenCode recovery message boundary is no longer available')
        return result.reverse()
      }
      cursor = loaded.cursor.next
    }
    throw new Error('OpenCode recovery exceeded its message limit')
  }

  /** Wait for cold location/provider catalogs before filling desktop/phone pickers. */
  async resources(): Promise<OpenCodeResources> {
    const agents = await settledList(() => this.agents())
    const [models, defaultModel, providers, commands, skills] = await Promise.all([
      this.models(), this.defaultModel(), this.providers(), this.commands(), this.skills(),
    ])
    return {
      models: parseOpenCodeV2Models(models, defaultModel, providers),
      agents: parseOpenCodeV2Agents(agents),
      commands: parseOpenCodeV2Commands(commands, skills),
    }
  }

  async mcpStatus(signal?: AbortSignal): Promise<McpServerInfo[]> {
    return parseOpenCodeV2McpStatus(await this.call(async (sdk) => (await sdk.mcp.list({ location: this.location }, { signal: boundedReadSignal(signal) })).data))
  }

  /** Native 2.0.24 debounces the MCP tool registry for 100ms after connect. */
  async waitForHostMcp(signal?: AbortSignal) {
    const deadline = Date.now() + 5000
    let connectedSince: number | undefined
    while (Date.now() < deadline) {
      signal?.throwIfAborted()
      const server = (await this.mcpStatus(signal)).find(item => item.name === 'superone')
      if (server?.status === 'connected') {
        connectedSince ??= Date.now()
        if (Date.now() - connectedSince >= 150) return
      } else {
        connectedSince = undefined
        if (server && server.status !== 'pending') throw new Error('SuperOne host MCP did not connect')
      }
      await new Promise(resolve => setTimeout(resolve, 75))
    }
    throw new Error('SuperOne host MCP catalog did not finish loading')
  }

  putMcp(name: string, config: OpenCodeV2McpConfig): Promise<void> {
    return this.call((sdk) => sdk.mcp.add({ server: name, location: this.location, config }))
  }

  connectMcp(name: string, signal?: AbortSignal, assertControl?: () => void): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.mcp.connect({ server: name, location: this.location }, { signal }) })
  }

  disconnectMcp(name: string): Promise<void> {
    return this.call((sdk) => sdk.mcp.disconnect({ server: name, location: this.location }))
  }

  createSession(permissions: OpenCodeV2PermissionRule[]): Promise<OpenCodeV2Session> {
    return this.call((sdk) => sdk.session.create({ location: this.location, permissions }))
  }

  getSession(sessionId: string): Promise<OpenCodeV2Session> {
    return this.call((sdk) => sdk.session.get({ sessionID: sessionId }))
  }

  updateSession(sessionId: string, patch: { title?: string; permissions?: OpenCodeV2PermissionRule[] }): Promise<void> {
    return this.call((sdk) => sdk.session.update({ sessionID: sessionId, ...patch }))
  }

  switchModel(sessionId: string, model: OpenCodeV2ModelRef, assertControl?: () => void): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.session.switchModel({ sessionID: sessionId, model }) })
  }

  switchAgent(sessionId: string, agent: string, assertControl?: () => void): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.session.switchAgent({ sessionID: sessionId, agent }) })
  }

  /** Session-scoped system instructions; a repeated key replaces the entry. */
  putInstruction(sessionId: string, key: string, value: string): Promise<void> {
    return this.call((sdk) => sdk.session.instructions.entry.put({ sessionID: sessionId, key, value }))
  }

  async prompt(sessionId: string, input: Omit<SessionPromptInput, 'sessionID'>, signal?: AbortSignal, assertControl?: () => void): Promise<string> {
    return this.call(async (sdk) => { assertControl?.(); return (await sdk.session.prompt({ sessionID: sessionId, ...input }, { signal })).id })
  }

  command(sessionId: string, input: { name: string; text: string; files: Array<{ uri: string; name: string }> }, assertControl?: () => void, signal?: AbortSignal): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.session.command({ sessionID: sessionId, ...input }, { signal }) })
  }

  shell(sessionId: string, command: string, assertControl?: () => void, signal?: AbortSignal): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.session.shell({ sessionID: sessionId, command }, { signal }) })
  }

  async compact(sessionId: string, assertControl?: () => void, signal?: AbortSignal): Promise<void> {
    await this.call((sdk) => { assertControl?.(); return sdk.session.compact({ sessionID: sessionId }, { signal }) })
  }

  async interrupt(sessionId: string): Promise<void> {
    // Cleanup must reach an attached server even after the turn's signal aborts.
    const cleanup = this.opts.signal ? new OpenCodeV2Client({ ...this.opts, signal: undefined }) : this
    await cleanup.call((sdk) => sdk.session.interrupt({ sessionID: sessionId }, { signal: AbortSignal.timeout(3000) }))
  }

  permissions(sessionId: string, signal?: AbortSignal): Promise<OpenCodeV2PermissionRequest[]> {
    const bounded = boundedReadSignal(signal)
    return this.call((sdk) => sdk.permission.list({ sessionID: sessionId }, { signal: bounded }))
  }

  permissionReply(sessionId: string, requestId: string, decision: 'once' | 'always' | 'reject'): Promise<void> {
    return this.call((sdk) => sdk.permission.reply({ sessionID: sessionId, requestID: requestId, decision }))
  }

  forms(sessionId: string, signal?: AbortSignal): Promise<OpenCodeV2Form[]> {
    const bounded = boundedReadSignal(signal)
    return this.call((sdk) => sdk.session.form.list({ sessionID: sessionId }, { signal: bounded }))
  }

  formReply(sessionId: string, formId: string, answer: Record<string, OpenCodeV2FormValue>): Promise<void> {
    return this.call((sdk) => sdk.session.form.reply({ sessionID: sessionId, formID: formId, answer }))
  }

  formCancel(sessionId: string, formId: string): Promise<void> {
    return this.call((sdk) => sdk.session.form.cancel({ sessionID: sessionId, formID: formId }))
  }

  messages(sessionId: string, query: Omit<MessageListInput, 'sessionID'>): Promise<OpenCodeV2Message[]> {
    return this.call(async (sdk) => (await sdk.message.list({ sessionID: sessionId, ...query })).data)
  }

  /** File changes from the turn of `from` through the turn of `to`. */
  diff(sessionId: string, from: string, to?: string): Promise<OpenCodeV2FileDiff[]> {
    return this.call((sdk) => sdk.session.diff({ sessionID: sessionId, from, to }))
  }

  /** Reversible: hides history from `messageId` on and restores its files. */
  async revertStage(sessionId: string, messageId: string, assertControl?: () => void, files = true): Promise<void> {
    await this.call((sdk) => { assertControl?.(); return sdk.session.revert.stage({ sessionID: sessionId, messageID: messageId, files }) })
  }

  revertClear(sessionId: string): Promise<void> {
    return this.call((sdk) => sdk.session.revert.clear({ sessionID: sessionId }))
  }

  async forkSession(sessionId: string, messageId?: string, assertControl?: () => void): Promise<{ id: string; directory: string }> {
    const session = await this.call((sdk) => { assertControl?.(); return sdk.session.fork({ sessionID: sessionId, before: messageId }) })
    return { id: session.id, directory: session.location.directory }
  }

  moveSession(sessionId: string, directory: string, assertControl?: () => void): Promise<void> {
    return this.call((sdk) => { assertControl?.(); return sdk.session.move({ sessionID: sessionId, directory: canonicalDirectory(directory) }) })
  }

  deleteSession(sessionId: string): Promise<void> {
    return this.call((sdk) => sdk.session.remove({ sessionID: sessionId }))
  }

  /** SDK subscriptions are lazy; the runtime must be connected before a prompt. */
  async eventStream(signal: AbortSignal): Promise<AsyncIterable<OpenCodeV2Event>> {
    const sdk = await this.sdk
    const startup = new AbortController()
    const timer = setTimeout(() => startup.abort(), 5000)
    const iterator = sdk.event.subscribe({ signal: AbortSignal.any([signal, startup.signal]) })[Symbol.asyncIterator]()
    try {
      const first = await iterator.next()
      if (signal.aborted) throw new OpenCodeApiError('OpenCode event subscription aborted')
      if (startup.signal.aborted) throw new OpenCodeApiError('OpenCode event subscription timed out')
      if (first.done || first.value.type !== 'server.connected') {
        throw new OpenCodeApiError('OpenCode event stream closed before confirming the connection')
      }
      return (async function* () {
        try {
          yield first.value
          for (;;) {
            const next = await iterator.next()
            if (next.done) return
            yield next.value
          }
        } finally {
          await iterator.return?.()
        }
      })()
    } catch (error) {
      await iterator.return?.()
      throw error
    } finally {
      clearTimeout(timer)
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

export function parseOpenCodeV2Commands(commands: OpenCodeV2Command[], skills: OpenCodeV2Skill[] = []): SlashCommandInfo[] {
  const catalog: SlashCommandInfo[] = commands.map((command) => ({
    name: command.name.replace(/^\//, ''),
    description: command.description ?? '',
    argumentHint: '',
    isSkill: false,
  }))
  const names = new Set([...catalog.map((command) => command.name), 'init', 'compact', 'share', 'unshare'])
  for (const skill of skills) {
    const name = skill.name.replace(/^\//, '')
    if (names.has(name)) continue
    names.add(name)
    catalog.push({ name, description: skill.description ?? '', argumentHint: '', isSkill: true, skillId: skill.id })
  }
  return catalog
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

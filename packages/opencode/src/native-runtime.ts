import { superoneSystemPrompt } from '@superone/shared/superone-system-prompt'
import { OpenCodeOAuth } from './opencode-oauth'
import { OpenCodeRecovery } from './opencode-recovery'
import { OpenCodeInbox } from './opencode-inbox'
import { openCodeProjectionEvents } from './opencode-v2-projection'
import type { EffortLevel } from '@superone/shared/agent-types'
import {
  buildOpenCodeContextUsage,
  OpenCodeApiError,
  openCodeAttachmentTurn as defaultAttachmentTurn,
  parseOpenCodeModelSlug,
} from './runtime-helpers'
import { closeServer, errorMessage, withAbortSignal, withOpenCodeLocalCommands } from './runtime-helpers'
import type {
  OpenCodeMcpRegistrar,
  OpenCodeRuntime,
  OpenCodeRuntimeEvent,
  OpenCodeRuntimeOptions,
} from './runtime-types'
import type { NativeRuntimePorts } from './runtime-ports'

import { OpenCodeV2Client, toOpenCodeV2McpConfig, toOpenCodeV2Ruleset } from './opencode-v2-client'
import { openCodeV2EventSessionId, openCodeV2FormAnswer } from './opencode-v2-event-map'
import { resolveOpenCodeCommandInvocation } from './runtime-helpers'
import type { OpenCodeServerHandle } from './server'
import type { OpenCodeV2Event, OpenCodeV2McpConfig, OpenCodeV2ModelRef, OpenCodeV2Session } from './opencode-v2-types'

/** Instruction entry carrying SuperOne's system prompt append; a re-put replaces it. */
const SUPERONE_INSTRUCTION_KEY = 'superone'

/** 2.x has no share endpoint. */
const UNSUPPORTED_LOCAL_COMMANDS = new Set(['share', 'unshare'])

/** A switch without `variant` selects the model's `default` variant. */
function modelKey(model: OpenCodeV2ModelRef | undefined): string {
  return model ? `${model.providerID}/${model.id}#${model.variant ?? 'default'}` : ''
}

function unsupported(feature: string): Promise<never> {
  return Promise.reject(new OpenCodeApiError(`${feature} is not available with OpenCode 2`))
}

function imageFiles(images: Array<{ mimeType: string; name: string; base64: string }>) {
  return images.map((image) => ({ uri: `data:${image.mimeType};base64,${image.base64}`, name: image.name }))
}

/**
 * OpenCode 2.x runtime over `/api/*`. Model, variant (effort) and agent are
 * session state in 2.x rather than prompt fields, so each turn switches them
 * only when they differ from what the session already has.
 */
export async function createOpenCodeV2Runtime(
  server: OpenCodeServerHandle,
  opts: OpenCodeRuntimeOptions,
  ports: NativeRuntimePorts,
): Promise<OpenCodeRuntime> {
  let closing = false
  const { buildOpenCodeHostPermissionRules, reconcileOpenCodePermissions, syncMcpServers } = ports
  const openCodeAttachmentTurn = ports.attachmentTurn ?? defaultAttachmentTurn
  const client = (ports.createClient ?? ((options) => new OpenCodeV2Client(options)))({
    baseUrl: server.url,
    directory: opts.cwd,
    password: server.password,
  })
  const mcpRegistrar: OpenCodeMcpRegistrar<OpenCodeV2McpConfig> = {
    toConfig: (config, host) => toOpenCodeV2McpConfig(config, { host }),
    // The initial native plugin registry must see direct host tools while the
    // location boots. Re-adding that same server resets its catalog mid-startup.
    add: (name, config) => name === 'superone' && server.hostMcpConfigured ? Promise.resolve() : client.putMcp(name, config),
    disconnect: (name) => client.disconnectMcp(name),
  }

  let mcpNames = await withAbortSignal(syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, new Set()), opts.signal)
  let resources = await withAbortSignal(client.resources(), opts.signal)
  let session: OpenCodeV2Session
  if (opts.providerSessionId) {
    session = await withAbortSignal(client.getSession(opts.providerSessionId), opts.signal)
    const permissions = toOpenCodeV2Ruleset(
      reconcileOpenCodePermissions(
        session.permissions?.map((rule) => ({
          permission: rule.action,
          pattern: rule.resource,
          action: rule.effect,
        })),
      ),
    )
    await withAbortSignal(client.updateSession(session.id, { permissions }), opts.signal)
  } else {
    session = await withAbortSignal(
      client.createSession(toOpenCodeV2Ruleset(buildOpenCodeHostPermissionRules())),
      opts.signal,
    )
  }
  const sessionId = session.id
  if (server.hostMcpConfigured) await withAbortSignal(client.waitForHostMcp(opts.signal), opts.signal)
  if (session.location.directory !== client.directory)
    throw new Error('The native OpenCode session belongs to another directory')
  await withAbortSignal(
    client.putInstruction(sessionId, SUPERONE_INSTRUCTION_KEY, superoneSystemPrompt(opts.systemPromptAppend)),
    opts.signal,
  )

  const abortController = new AbortController()
  const oauth = new OpenCodeOAuth({
    client,
    sessionId,
    signal: abortController.signal,
    onEvent: opts.onEvent,
    openUrl: ports.openUrl,
    assertControl: ports.assertOAuthControl,
  })
  const inbox = new OpenCodeInbox(client, sessionId, abortController.signal, (items) =>
    opts.onEvent({ type: 'runtime.inbox', properties: { items } }),
  )
  let reloading = false
  let catalogTimer: ReturnType<typeof setTimeout> | undefined
  let catalogRead: Promise<void> | undefined
  let catalogDirty = false
  let catalogRefreshed = false
  let turnBoundary: string | undefined
  let turnClientId: string | undefined
  let trackingTurn = false
  let turnDelivery: { assertControl?: () => void; onInputAccepted?: () => void; signal?: AbortSignal } | undefined
  const admitTurn = () => {
    abortController.signal.throwIfAborted()
    turnDelivery?.signal?.throwIfAborted()
    turnDelivery?.assertControl?.()
    turnDelivery?.onInputAccepted?.()
  }
  let agentRevision = 0
  const agentCatalogWaiters = new Set<() => void>()
  const waitForAgentCatalog = (revision: number) => {
    if (agentRevision !== revision) return Promise.resolve()
    abortController.signal.throwIfAborted()
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer)
        agentCatalogWaiters.delete(updated)
        abortController.signal.removeEventListener('abort', aborted)
        if (error) reject(error)
        else resolve()
      }
      const updated = () => finish()
      const aborted = () => finish(abortController.signal.reason)
      const timer = setTimeout(
        () => finish(new Error('OpenCode agent catalog did not finish loading; try refreshing again')),
        3000,
      )
      agentCatalogWaiters.add(updated)
      abortController.signal.addEventListener('abort', aborted, { once: true })
    })
  }
  const readCatalog = () => {
    if (catalogRead) return catalogRead
    catalogDirty = false
    catalogRead = client
      .resources()
      .then((fresh) => {
        if (closing || reloading) return
        resources = fresh
        catalogRefreshed = true
        opts.onEvent({ type: 'runtime.resources', properties: { resources: fresh } })
      })
      .catch(() => {
        /* Explicit refresh reports errors; watcher reads retain the last catalog. */
      })
      .finally(() => {
        catalogRead = undefined
        if (catalogDirty && !reloading && !closing) void readCatalog()
      })
    return catalogRead
  }
  const [stream, pendingPermissions, pendingForms] = await withAbortSignal(
    Promise.all([
      client.eventStream(abortController.signal),
      client.permissions(sessionId, abortController.signal).catch(() => []),
      client.forms(sessionId, abortController.signal).catch(() => []),
    ]),
    opts.signal,
  ).catch((error: unknown) => {
    abortController.abort()
    throw error
  })
  // Pending interactions, kept current by the stream so the snapshot replayed on
  // attach never re-raises one resolved while the runtime was starting.
  const permissions = new Map(pendingPermissions.map((request) => [request.id, request]))
  const forms = new Map(pendingForms.map((form) => [form.id, form]))

  const onNativeEvent = (event: OpenCodeV2Event, replay = false) => {
    if (
      ['agent.updated', 'skill.updated', 'command.updated'].includes(event.type) &&
      event.location?.directory === client.directory
    ) {
      if (event.type === 'agent.updated') {
        agentRevision += 1
        for (const updated of agentCatalogWaiters) updated()
      }
      catalogDirty = true
      if (!reloading && !closing) {
        clearTimeout(catalogTimer)
        catalogTimer = setTimeout(() => {
          void readCatalog()
        }, 100)
      }
    }
    if (openCodeV2EventSessionId(event) !== sessionId) return
    if (event.type === 'permission.asked') permissions.set(event.data.id, event.data)
    if (event.type === 'form.created') forms.set(event.data.form.id, event.data.form)
    if (event.type === 'form.replied' || event.type === 'form.cancelled') forms.delete(event.data.id)
    if (event.type === 'permission.replied') permissions.delete(event.data.requestID)
    if (event.type.startsWith('session.inbox.')) void inbox.refresh().catch(() => {})
    opts.onEvent({ type: 'v2', event, ...(replay ? { replay: true } : {}) })
  }
  const reconcile = async (missingReplay?: boolean) => {
    let restored: string[] = []
    if (missingReplay && trackingTurn) {
      const messages = await client.messagesSince(sessionId, turnBoundary, abortController.signal)
      abortController.signal.throwIfAborted()
      for (const event of openCodeProjectionEvents(sessionId, messages)) onNativeEvent(event, true)
      restored = messages.filter((message) => message.type === 'assistant').map((message) => message.id)
    }
    const [pendingPermissions, pendingForms] = await Promise.all([
      client.permissions(sessionId, abortController.signal),
      client.forms(sessionId, abortController.signal),
    ])
    abortController.signal.throwIfAborted()
    const resolvedPermissions = [...permissions.keys()].filter(
      (id) => !pendingPermissions.some((item) => item.id === id),
    )
    const resolvedForms = [...forms.keys()].filter((id) => !pendingForms.some((item) => item.id === id))
    for (const id of resolvedPermissions) permissions.delete(id)
    for (const id of resolvedForms) forms.delete(id)
    opts.onEvent({ type: 'runtime.interactions', properties: { resolvedPermissions, resolvedForms } })
    for (const request of pendingPermissions)
      if (!permissions.has(request.id))
        onNativeEvent({ id: `recovery-${request.id}`, type: 'permission.asked', data: request })
    for (const form of pendingForms)
      if (!forms.has(form.id)) onNativeEvent({ id: `recovery-${form.id}`, type: 'form.created', data: { form } })
    await inbox.refresh()
    catalogDirty = true
    void readCatalog()
    return restored
  }
  const recovery = new OpenCodeRecovery(
    client,
    sessionId,
    abortController.signal,
    onNativeEvent,
    reconcile,
    (state, attempt) => opts.onEvent({ type: 'runtime.connection', properties: { state, attempt } }),
  )
  await withAbortSignal(
    recovery.initialize().then(() => inbox.refresh()),
    opts.signal,
  ).catch((error) => {
    abortController.abort()
    throw error
  })
  const subscriptionPromise = recovery.run(stream).catch(() => {
    // Keep native execution and turn identity while disconnected. The
    // connection fact exposes Retry, which resumes facts, never the prompt.
  })

  if (server.exited) {
    void server.exited.then(({ code, signal }) => {
      if (!closing) {
        opts.onEvent({
          type: 'runtime.error',
          properties: { message: `OpenCode server exited unexpectedly (${code ?? signal ?? 'unknown'})` },
        })
      }
    })
  }

  let legacyAgent = opts.permissionMode === 'plan' ? 'plan' : undefined
  let appliedModel = modelKey(session.model)
  let appliedAgent = session.agent

  async function applyTurnSettings(
    model: string | undefined,
    effort: EffortLevel | undefined,
    agent: string | undefined,
    assertControl = turnDelivery?.assertControl,
  ) {
    await recovery.ready()
    abortController.signal.throwIfAborted()
    const parsed = parseOpenCodeModelSlug(model)
    if (model && !parsed) throw new OpenCodeApiError(`Invalid OpenCode model id: ${model}`)
    if (parsed) {
      const ref: OpenCodeV2ModelRef = {
        providerID: parsed.providerID,
        id: parsed.modelID,
        ...(effort ? { variant: effort } : {}),
      }
      if (modelKey(ref) !== appliedModel) {
        await client.switchModel(sessionId, ref, assertControl)
        appliedModel = modelKey(ref)
      }
    }
    // Native agent selection is sticky. A legacy Plan launch seeds it once;
    // an explicit agent always wins, and no permission setting overrides it.
    const missingAgent = catalogRefreshed && appliedAgent && !resources.agents.some((item) => item.id === appliedAgent)
    const nextAgent =
      agent ??
      legacyAgent ??
      (missingAgent ? (resources.agents.find((item) => item.id === 'build') ?? resources.agents[0])?.id : undefined)
    if (nextAgent && nextAgent !== appliedAgent) {
      await client.switchAgent(sessionId, nextAgent, assertControl)
      appliedAgent = nextAgent
    }
    legacyAgent = undefined
  }

  async function latestUserMessageId(): Promise<string | undefined> {
    const [latest] = await client.messages(sessionId, { type: 'user', order: 'desc', limit: 1 })
    return latest?.id
  }

  return {
    sessionId,
    get agent() {
      return appliedAgent
    },
    get models() {
      return resources.models
    },
    get agents() {
      return resources.agents
    },
    get commands() {
      return withOpenCodeLocalCommands(resources.commands).filter(
        (command) => !UNSUPPORTED_LOCAL_COMMANDS.has(command.name),
      )
    },
    get hasPendingAuthentication() {
      return oauth.busy
    },
    get snapshotEvents(): OpenCodeRuntimeEvent[] {
      return [
        ...(inbox.items.length ? [{ type: 'runtime.inbox' as const, properties: { items: inbox.items } }] : []),
        ...oauth.snapshotEvents,
        ...[...permissions.values()].map((request) => ({
          type: 'v2' as const,
          event: { id: `snapshot-${request.id}`, type: 'permission.asked' as const, data: request },
        })),
        ...[...forms.values()].map((form) => ({
          type: 'v2' as const,
          event: { id: `snapshot-${form.id}`, type: 'form.created' as const, data: { form } },
        })),
      ]
    },
    setTitle: (title) => client.updateSession(sessionId, { title }),
    supportsStreamingToolInput: true,
    waitForConnection: () => recovery.ready(),
    reconnect: async () => {
      const endpoint = await server.reconnect?.()
      if (endpoint) {
        client.setEndpoint(endpoint.url, endpoint.password)
        if (endpoint.replaced) {
          if (trackingTurn) opts.onEvent({ type: 'runtime.interrupted', properties: { reason: 'owned-service-restarted' } })
          mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
        }
      }
      await recovery.retry()
    },
    prepareTurn: async (clientMessageId, delivery) => {
      await recovery.ready()
      turnBoundary = (await client.messages(sessionId, { order: 'desc', limit: 1 }))[0]?.id
      abortController.signal.throwIfAborted()
      turnClientId = clientMessageId
      trackingTurn = true
      turnDelivery = delivery
    },
    finishTurn: () => {
      trackingTurn = false
      turnDelivery = undefined
      recovery.finishTurn()
    },
    listInbox: () => inbox.refresh(),
    cancelInbox: async (id, assertControl) => {
      await recovery.ready()
      await inbox.cancel(id, assertControl)
    },
    updateInbox: async (id, delivery, assertControl) => {
      await recovery.ready()
      await inbox.update(id, delivery, assertControl)
    },
    refreshResources: async (assertControl) => {
      await recovery.ready()
      if (opts.config.serverUrl?.trim()) throw new Error('Catalog reload requires a SuperOne-managed OpenCode server')
      if (oauth.busy || permissions.size || forms.size)
        throw new Error('Finish pending OpenCode interactions before refreshing catalogs')
      reloading = true
      clearTimeout(catalogTimer)
      try {
        await server.refreshConfig?.()
        await catalogRead
        const priorRevision = agentRevision
        await client.reloadLocation(assertControl)
        assertControl?.()
        mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
        // Reload restarts services before project-defined agents have loaded.
        // Prime the lazy catalog, then wait for its native readiness update so
        // a partial built-in list cannot replace a valid selected agent.
        await client.resources()
        await waitForAgentCatalog(priorRevision)
        catalogDirty = false
        const fresh = await client.resources()
        abortController.signal.throwIfAborted()
        session = await client.getSession(sessionId)
        appliedModel = modelKey(session.model)
        appliedAgent = session.agent
        if (appliedAgent && !fresh.agents.some((agent) => agent.id === appliedAgent) && fresh.agents.length) {
          assertControl?.()
          const fallback = fresh.agents.find((agent) => agent.id === 'build') ?? fresh.agents[0]
          await client.switchAgent(sessionId, fallback.id)
          appliedAgent = fallback.id
        }
        resources = fresh
        catalogRefreshed = true
        return fresh
      } finally {
        reloading = false
        if (catalogDirty && !closing) void readCatalog()
      }
    },
    steer: async (request, onInputAccepted, assertControl) => {
      const invocation = resolveOpenCodeCommandInvocation(request.content, resources.commands)
      // Native command callbacks and shells are immediate operations, not
      // steerable inbox prompts. Keep those in the host queue for their own turn.
      if (
        request.content.startsWith('!') ||
        (invocation && !invocation.skillId) ||
        ['/init', '/compact', '/share', '/unshare'].includes(request.content.trim())
      ) {
        throw new OpenCodeApiError('Only text prompts and native skills can steer an OpenCode turn')
      }
      const turn = openCodeAttachmentTurn(
        request.images,
        invocation?.skillId ? (invocation.arguments ?? '') : request.content,
      )
      await applyTurnSettings(request.model, request.effort, request.agent, assertControl ?? (() => {}))
      return client.prompt(
        sessionId,
        {
          text: turn.text,
          files: imageFiles(turn.images),
          delivery: 'steer',
          ...(invocation?.skillId ? { skills: [{ id: invocation.skillId }] } : {}),
          ...(request.clientMessageId ? { metadata: { superoneClientMessageId: request.clientMessageId } } : {}),
        },
        AbortSignal.timeout(15000),
        () => {
          abortController.signal.throwIfAborted()
          assertControl?.()
          onInputAccepted()
        },
      )
    },
    prompt: async (text, model, effort, images, agent, skills) => {
      const turn = openCodeAttachmentTurn(images, text)
      await applyTurnSettings(model, effort, agent)
      await client.prompt(
        sessionId,
        {
          text: turn.text,
          files: imageFiles(turn.images),
          ...(turnClientId ? { metadata: { superoneClientMessageId: turnClientId } } : {}),
          ...(skills?.length ? { skills: skills.map((id) => ({ id })) } : {}),
        },
        turnDelivery?.signal,
        admitTurn,
      )
    },
    command: async (name, args, model, effort, images, agent) => {
      const turn = openCodeAttachmentTurn(images, args ?? '')
      await applyTurnSettings(model, effort, agent)
      await client.command(
        sessionId,
        { name, text: turn.text, files: imageFiles(turn.images) },
        admitTurn,
        turnDelivery?.signal,
      )
    },
    shell: async (command, model, agent) => {
      await applyTurnSettings(model, undefined, agent)
      abortController.signal.throwIfAborted()
      await client.shell(sessionId, command, admitTurn, turnDelivery?.signal)
    },
    init: async (model) => {
      await applyTurnSettings(model, undefined, undefined)
      await client.command(sessionId, { name: 'init', text: '', files: [] }, admitTurn, turnDelivery?.signal)
    },
    compact: async () => {
      await recovery.ready()
      abortController.signal.throwIfAborted()
      await client.compact(sessionId, admitTurn, turnDelivery?.signal)
    },
    share: () => unsupported('Session sharing'),
    unshare: () => unsupported('Session sharing'),
    getContextUsage: async () => {
      const messages = await client.messages(sessionId, { order: 'desc', limit: 50 })
      const assistant = messages.find((message) => message.type === 'assistant' && message.tokens && message.model)
      if (assistant?.type !== 'assistant' || !assistant.tokens) return null
      return buildOpenCodeContextUsage(
        assistant.tokens,
        `${assistant.model.providerID}/${assistant.model.id}`,
        resources.models,
      )
    },
    diff: async (messageId) => client.diff(sessionId, messageId, await latestUserMessageId()),
    revert: (messageId) => client.revertStage(sessionId, messageId),
    unrevert: () => client.revertClear(sessionId),
    setModel: async () => undefined,
    cancel: () => client.interrupt(sessionId),
    permissionReply: (requestId, reply) => client.permissionReply(sessionId, requestId, reply),
    questionReply: async (requestId, answers) => {
      if (oauth.reply(requestId, answers)) return
      const form = forms.get(requestId)
      if (!form) throw new OpenCodeApiError(`OpenCode form ${requestId} is no longer pending`)
      forms.delete(requestId)
      await client.formReply(sessionId, requestId, openCodeV2FormAnswer(form, answers))
    },
    questionReject: async (requestId) => {
      if (oauth.reject(requestId)) return
      forms.delete(requestId)
      await client.formCancel(sessionId, requestId)
    },
    getMcpServerStatus: () => client.mcpStatus(),
    authenticateMcp: async (name, assertControl) => {
      if (opts.config.serverUrl?.trim()) throw new Error('MCP OAuth is only supported for a local OpenCode runtime')
      if (reloading) throw new Error('Wait for the OpenCode catalog refresh before signing in')
      await oauth.authenticate(name, assertControl)
    },
    reconnectMcp: async (name) => {
      mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
      await client.disconnectMcp(name).catch(() => undefined)
      await client.connectMcp(name)
    },
    toggleMcpServer: async (name, enabled) => {
      if (enabled) {
        mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
        await client.connectMcp(name)
      } else {
        await client.disconnectMcp(name)
      }
    },
    reloadMcpServers: async () => {
      mcpNames = await syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, mcpNames)
    },
    close: async () => {
      if (closing) return
      closing = true
      clearTimeout(catalogTimer)
      abortController.abort()
      await oauth.close()
      await subscriptionPromise.catch(() => undefined)
      await recovery.join()
      await closeServer(server)
    },
  }
}

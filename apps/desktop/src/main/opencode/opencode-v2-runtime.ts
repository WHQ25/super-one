import { superoneSystemPrompt } from '@superone/shared/superone-system-prompt'
import type { EffortLevel } from '@superone/shared/agent-types'
import {
  buildOpenCodeContextUsage,
  OpenCodeApiError,
  openCodeAttachmentTurn,
  parseOpenCodeModelSlug,
  withOpenCodeLocalCommands,
  type OpenCodeServerHandle,
} from './opencode-client'
import {
  buildOpenCodeHostPermissionRules,
  reconcileOpenCodePermissions,
  closeServer,
  errorMessage,
  syncMcpServers,
  withAbortSignal,
  type OpenCodeMcpRegistrar,
  type OpenCodeRuntime,
  type OpenCodeRuntimeEvent,
  type OpenCodeRuntimeOptions,
} from './opencode-runtime'
import {
  OpenCodeV2Client,
  parseOpenCodeV2Agents,
  parseOpenCodeV2Commands,
  parseOpenCodeV2Models,
  toOpenCodeV2McpConfig,
  toOpenCodeV2Ruleset,
} from './opencode-v2-client'
import { openCodeV2EventSessionId, openCodeV2FormAnswer } from './opencode-v2-event-map'
import type { OpenCodeV2McpConfig, OpenCodeV2ModelRef, OpenCodeV2Session } from './opencode-v2-types'

/** Instruction entry carrying SuperOne's system prompt append; a re-put replaces it. */
const SUPERONE_INSTRUCTION_KEY = 'superone'

/** 2.x has no share endpoint. */
const UNSUPPORTED_LOCAL_COMMANDS = new Set(['share', 'unshare'])

function hostPermissions() {
  return toOpenCodeV2Ruleset(buildOpenCodeHostPermissionRules())
}

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
): Promise<OpenCodeRuntime> {
  let closing = false
  const client = new OpenCodeV2Client({ baseUrl: server.url, directory: opts.cwd, password: server.password })
  const mcpRegistrar: OpenCodeMcpRegistrar<OpenCodeV2McpConfig> = {
    toConfig: (config, host) => toOpenCodeV2McpConfig(config, { host }),
    add: (name, config) => client.putMcp(name, config),
    disconnect: (name) => client.disconnectMcp(name),
  }

  let mcpNames = await withAbortSignal(syncMcpServers(mcpRegistrar, opts.cwd, opts.sessionId, new Set()), opts.signal)
  const resources = await withAbortSignal(client.resources(), opts.signal)
  let session: OpenCodeV2Session
  if (opts.providerSessionId) {
    session = await withAbortSignal(client.getSession(opts.providerSessionId), opts.signal)
    const permissions = toOpenCodeV2Ruleset(reconcileOpenCodePermissions(session.permissions?.map((rule) => ({
      permission: rule.action, pattern: rule.resource, action: rule.effect,
    }))))
    await withAbortSignal(client.updateSession(session.id, { permissions }), opts.signal)
  } else {
    session = await withAbortSignal(client.createSession(hostPermissions()), opts.signal)
  }
  const sessionId = session.id
  await withAbortSignal(
    client.putInstruction(sessionId, SUPERONE_INSTRUCTION_KEY, superoneSystemPrompt(opts.systemPromptAppend)),
    opts.signal,
  )

  const abortController = new AbortController()
  const [stream, pendingPermissions, pendingForms] = await withAbortSignal(
    Promise.all([
      client.eventStream(abortController.signal),
      client.permissions(sessionId).catch(() => []),
      client.forms(sessionId).catch(() => []),
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

  const subscriptionPromise = (async () => {
    try {
      for await (const event of stream) {
        if (openCodeV2EventSessionId(event) !== sessionId) continue
        if (event.type === 'form.created') forms.set(event.data.form.id, event.data.form)
        if (event.type === 'form.replied' || event.type === 'form.cancelled') forms.delete(event.data.id)
        if (event.type === 'permission.replied') permissions.delete(event.data.requestID)
        opts.onEvent({ type: 'v2', event })
      }
      if (!closing && !abortController.signal.aborted) {
        opts.onEvent({ type: 'runtime.error', properties: { message: 'OpenCode event stream closed unexpectedly' } })
      }
    } catch (error) {
      if (!closing && !abortController.signal.aborted) {
        opts.onEvent({ type: 'runtime.error', properties: { message: errorMessage(error) } })
      }
    }
  })()

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

  async function applyTurnSettings(model: string | undefined, effort: EffortLevel | undefined, agent: string | undefined) {
    const parsed = parseOpenCodeModelSlug(model)
    if (model && !parsed) throw new OpenCodeApiError(`Invalid OpenCode model id: ${model}`)
    if (parsed) {
      const ref: OpenCodeV2ModelRef = { providerID: parsed.providerID, id: parsed.modelID, ...(effort ? { variant: effort } : {}) }
      if (modelKey(ref) !== appliedModel) {
        await client.switchModel(sessionId, ref)
        appliedModel = modelKey(ref)
      }
    }
    // Native agent selection is sticky. A legacy Plan launch seeds it once;
    // an explicit agent always wins, and no permission setting overrides it.
    const nextAgent = agent ?? legacyAgent
    if (nextAgent && nextAgent !== appliedAgent) {
      await client.switchAgent(sessionId, nextAgent)
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
    get agent() { return appliedAgent },
    models: resources.models,
    agents: resources.agents,
    commands: withOpenCodeLocalCommands(resources.commands)
      .filter((command) => !UNSUPPORTED_LOCAL_COMMANDS.has(command.name)),
    get snapshotEvents(): OpenCodeRuntimeEvent[] {
      return [
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
    prompt: async (text, model, effort, images, agent) => {
      const turn = openCodeAttachmentTurn(images, text)
      await applyTurnSettings(model, effort, agent)
      await client.prompt(sessionId, { text: turn.text, files: imageFiles(turn.images) })
    },
    command: async (name, args, model, effort, images, agent) => {
      const turn = openCodeAttachmentTurn(images, args ?? '')
      await applyTurnSettings(model, effort, agent)
      await client.command(sessionId, { name, text: turn.text, files: imageFiles(turn.images) })
    },
    shell: (command) => client.shell(sessionId, command),
    init: async (model) => {
      await applyTurnSettings(model, undefined, undefined)
      await client.command(sessionId, { name: 'init', text: '', files: [] })
    },
    compact: () => client.compact(sessionId),
    share: () => unsupported('Session sharing'),
    unshare: () => unsupported('Session sharing'),
    getContextUsage: async () => {
      const messages = await client.messages(sessionId, { order: 'desc', limit: 50 })
      const assistant = messages.find((message) => message.type === 'assistant' && message.tokens && message.model)
      if (!assistant?.tokens || !assistant.model) return null
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
      const form = forms.get(requestId)
      if (!form) throw new OpenCodeApiError(`OpenCode form ${requestId} is no longer pending`)
      forms.delete(requestId)
      await client.formReply(sessionId, requestId, openCodeV2FormAnswer(form, answers))
    },
    questionReject: async (requestId) => {
      forms.delete(requestId)
      await client.formCancel(sessionId, requestId)
    },
    getMcpServerStatus: () => client.mcpStatus(),
    authenticateMcp: () => unsupported('MCP sign-in from SuperOne (run `opencode mcp auth <name>`)'),
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
      abortController.abort()
      await subscriptionPromise.catch(() => undefined)
      await closeServer(server)
    },
  }
}

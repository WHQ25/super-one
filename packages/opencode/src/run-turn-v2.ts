import { superoneSystemPrompt } from '@superone/shared/superone-system-prompt'
import { waitForOpenCodeTurn } from './turn-settlement'
import { attachmentPrompt, buildAttachmentTurn } from '@superone/shared/attachment-turn'
import type { TurnRunner } from '@superone/runtime/session'
import { OpenCodeV2Client, toOpenCodeV2Ruleset } from './opencode-v2-client'
import { buildOpenCodeHostPermissionRules, reconcileOpenCodePermissions } from './permissions'
import { openCodeV2EventSessionId } from './opencode-v2-event-map'
import { OpenCodeRecovery } from './opencode-recovery'
import { openCodeProjectionEvents } from './opencode-v2-projection'
import { NodeOpenCodeV2Events } from './node-v2-events'
import { parseOpenCodeModelSlug } from './parse'
import type { OpenCodeServerHandle } from './server'
import type { RunOpenCodeTurnOptions } from './run-turn'

export async function runOpenCodeV2Turn(
  input: Parameters<TurnRunner>[0],
  server: OpenCodeServerHandle,
  cwd: string,
  opts: RunOpenCodeTurnOptions,
) {
  input.signal.throwIfAborted()
  if (/^\/(share|unshare)(?:\s|$)/.test(input.text.trim()))
    throw new Error('Session sharing is not available with OpenCode V2')
  const abort = new AbortController(),
    signal = AbortSignal.any([input.signal, abort.signal])
  const client = new OpenCodeV2Client({
    baseUrl: server.url,
    directory: cwd,
    password: server.password ?? opts.serverPassword ?? undefined,
    signal,
  })
  let nativeId = input.session.providerResume?.startsWith('opencode:')
    ? input.session.providerResume.slice(9)
    : undefined
  const session = nativeId
    ? await client.getSession(nativeId)
    : await client.createSession(toOpenCodeV2Ruleset(buildOpenCodeHostPermissionRules()))
  nativeId = session.id
  if (session.location.directory !== client.directory)
    throw new Error(
      'The native OpenCode session belongs to another directory; start a new session for this working directory',
    )
  if (input.session.providerResume)
    await client.updateSession(nativeId, {
      permissions: toOpenCodeV2Ruleset(
        reconcileOpenCodePermissions(
          session.permissions?.map((rule) => ({
            permission: rule.action,
            pattern: rule.resource,
            action: rule.effect,
          })),
        ),
      ),
    })
  const host = opts.getSuperoneMcp?.(input.session.sessionId) ?? opts.superoneMcp
  if (host)
    await client.putMcp('superone', {
      type: 'remote',
      url: host.url,
      headers: host.headers,
      disabled: false,
      codemode: false,
    })
  await client.putInstruction(nativeId, 'superone', superoneSystemPrompt())
  const resources = await client.resources()
  const parsed = parseOpenCodeModelSlug(input.model)
  if (input.model && !parsed) throw new Error(`Invalid OpenCode model id: ${input.model}`)
  if (parsed)
    await client.switchModel(nativeId, {
      providerID: parsed.providerID,
      id: parsed.modelID,
      ...(input.effort ? { variant: input.effort } : {}),
    })
  const agent =
    input.agent ??
    input.session.agent ??
    (!input.session.providerResume && input.permissionMode === 'plan' ? 'plan' : undefined)
  if (agent && agent !== session.agent) await client.switchAgent(nativeId, agent)
  const files = buildAttachmentTurn(input.images ?? [], {
    inlineImages: true,
    inlinePdf: false,
  })
  const text = attachmentPrompt(input.text, files.note)
  let resolve!: () => void, reject!: (error: Error) => void
  const finished = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  void finished.catch(() => {})
  const events = new NodeOpenCodeV2Events(
    input,
    client,
    nativeId,
    signal,
    (error) => (error ? reject(error) : resolve()),
    (model) => resources.models.find((item) => item.id === model)?.contextWindow,
  )
  let boundary: string | undefined,
    tracking = false
  const native = (event: Parameters<typeof events.apply>[0], replay = false) => {
    if (openCodeV2EventSessionId(event) === nativeId) events.apply(event, replay)
  }
  const recovery = new OpenCodeRecovery(
    client,
    nativeId,
    signal,
    native,
    async (missing) => {
      const messages = missing && tracking ? await client.messagesSince(nativeId!, boundary, signal) : []
      signal.throwIfAborted()
      for (const event of openCodeProjectionEvents(nativeId!, messages)) native(event, true)
      const [permissions, forms] = await Promise.all([
        client.permissions(nativeId!, signal),
        client.forms(nativeId!, signal),
      ])
      signal.throwIfAborted()
      for (const request of permissions)
        native({
          id: `recovery-${request.id}`,
          type: 'permission.asked',
          data: request,
        })
      for (const form of forms)
        native({
          id: `recovery-${form.id}`,
          type: 'form.created',
          data: { form },
        })
      return messages.filter((message) => message.type === 'assistant').map((message) => message.id)
    },
    (state, attempt) => {
      if (state !== 'disconnected')
        events.emit({
          type: 'harness_connection_changed',
          connection: { state, attempt },
        })
    },
  )
  let worker: Promise<void> | undefined
  const interrupted = () => events.finish(undefined, true)
  signal.addEventListener('abort', interrupted, { once: true })
  try {
    const stream = await client.eventStream(signal)
    await recovery.initialize()
    const [permissions, forms] = await Promise.all([
      client.permissions(nativeId, signal),
      client.forms(nativeId, signal),
    ])
    events.emit({
      type: 'message_start',
      message: {
        id: input.messageId ?? `opencode-${nativeId}`,
        role: 'assistant',
        status: 'streaming',
        content: [],
        providerId: 'opencode',
        createdAt: new Date().toISOString(),
      },
    })
    events.emit({ type: 'status_change', status: 'streaming' })
    events.emit({ type: 'provider_session_id', providerSessionId: nativeId })
    if (agent ?? session.agent)
      events.emit({ type: 'agent_setting_change', patch: { openCodeAgentId: agent ?? session.agent } })
    input.onProviderResume?.(`opencode:${nativeId}`)
    events.emit({
      type: 'session_agents',
      agents: resources.agents,
      commands: resources.commands,
      runtimeCapabilities: {
        harnessId: 'opencode',
        supportsQueuedSteer: false,
        supportsQueuedSteerSoon: false,
        supportsStreamingToolInput: true,
      },
    })
    for (const request of permissions)
      native({
        id: `pending-${request.id}`,
        type: 'permission.asked',
        data: request,
      })
    for (const form of forms)
      native({
        id: `pending-${form.id}`,
        type: 'form.created',
        data: { form },
      })
    boundary = (await client.messages(nativeId, { order: 'desc', limit: 1 }))[0]?.id
    tracking = true
    worker = recovery
      .run(stream)
      .catch((error: unknown) => events.finish(error instanceof Error ? error : new Error(String(error))))
    const guard = () => {
      signal.throwIfAborted()
      input.onInputAccepted?.()
    }
    let dispatch: Promise<unknown>
    if (input.text.startsWith('!')) {
      if (!input.text.slice(1).trim() || input.images?.length)
        throw new Error('OpenCode shell commands require a nonempty command and no attachments')
      dispatch = client.shell(nativeId, input.text.slice(1).trimStart(), guard, signal)
    } else if (input.text.trim() === '/compact') dispatch = client.compact(nativeId, guard, signal)
    else if (input.text.trim() === '/init')
      dispatch = client.command(nativeId, { name: 'init', text: '', files: [] }, guard, signal)
    else {
      const match = /^\/([^\s]+)(?:\s+([\s\S]*))?$/.exec(text)
      const command = match && resources.commands.find((item) => item.name === match[1])
      const images = files.attachments
        .filter((item) => item.inline)
        .map((item) => ({
          uri: `data:${item.mimeType};base64,${item.base64}`,
          name: item.name,
        }))
      if (command && !command.skillId)
        dispatch = client.command(nativeId, { name: command.name, text: match![2] ?? '', files: images }, guard, signal)
      else
        dispatch = client.prompt(
          nativeId,
          {
            text: command?.skillId ? (match![2] ?? '') : text,
            files: images,
            ...(command?.skillId ? { skills: [{ id: command.skillId }] } : {}),
            ...(input.clientMessageId ? { metadata: { superoneClientMessageId: input.clientMessageId } } : {}),
          },
          signal,
          guard,
        )
    }
    await waitForOpenCodeTurn(dispatch, finished)
    signal.throwIfAborted()
    return { finalText: events.text, providerResume: `opencode:${nativeId}` }
  } catch (error) {
    // An owned native terminal event is authoritative even if its HTTP receipt
    // was lost. Unknown delivery remains an error; neither path resubmits input.
    if (events.succeeded && !input.signal.aborted)
      return { finalText: events.text, providerResume: `opencode:${nativeId}` }
    events.finish(
      input.signal.aborted ? undefined : error instanceof Error ? error : new Error(String(error)),
      input.signal.aborted,
    )
    throw error
  } finally {
    if (input.signal.aborted) await client.interrupt(nativeId).catch(() => {})
    signal.removeEventListener('abort', interrupted)
    abort.abort()
    await worker
    await recovery.join()
  }
}

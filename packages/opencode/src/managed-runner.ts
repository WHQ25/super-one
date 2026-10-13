import type { AgentEvent, EffortLevel, ImageAttachment } from '@superone/shared/agent-types'
import type { HarnessOperationHost, NodeSessionRecord, TurnRunner } from '@superone/runtime/session'
import { createOpenCodeV2Runtime } from './native-runtime'
import type { OpenCodeRuntime, OpenCodeRuntimeEvent } from './runtime-types'
import { OpenCodeV2Client } from './opencode-v2-client'
import { buildOpenCodeHostPermissionRules, reconcileOpenCodePermissions } from './permissions'
import { openCodeAttachmentTurn, resolveOpenCodeCommandInvocation } from './runtime-helpers'
import { answerOpenCodeForm } from './form-controller'
import { openRemoteOpenCodeSignIn } from './remote-oauth'
import { NodeOpenCodeV2Events } from './node-v2-events'
import { startOpenCodeServer, isOpenCodeBinaryRunnable, type OpenCodeServerHandle } from './server'
import { runOpenCodeV1Turn } from './run-turn-v1'
import type { RunOpenCodeTurnOptions } from './run-turn'
import { OpenCodeSteeringGate } from './steering-gate'
import { openCodeSteerWasRejected } from './steer-rejection'
import { createHash } from 'node:crypto'
import { projectOpenCodeHistory } from './native-history'
import { startOpenCodeSessionServer } from './owned-service'
import { waitForOpenCodeTurn } from './turn-settlement'

type Input = Parameters<TurnRunner>[0]
interface LiveSession {
  runtime: OpenCodeRuntime
  client: OpenCodeV2Client
  server: OpenCodeServerHandle
  active?: NodeOpenCodeV2Events
  gate?: OpenCodeSteeringGate
  admission?: Promise<unknown>
  host?: HarnessOperationHost
  publish(event: AgentEvent): void
  signal: AbortSignal
  abort: AbortController
  lastUsedAt: number
  launchKey: string
  mapModel?: RunOpenCodeTurnOptions['mapModel']
  providerModels?: RunOpenCodeTurnOptions['providerModels']
  ambientAbort?: AbortController
}
type SessionHandle = LiveSession | { legacy: Awaited<ReturnType<TurnRunner>> }
function launchKey(opts: RunOpenCodeTurnOptions, cwd: string) {
  return createHash('sha256').update(JSON.stringify({ cwd, binary: opts.binaryPath, url: opts.serverUrl,
    password: opts.serverPassword, env: Object.entries(opts.env ?? {}).sort(([a], [b]) => a.localeCompare(b)) })).digest('hex')
}
function rewindSummary(changes: import('./runtime-types').OpenCodeFileChange[]) {
  return { canRewind: true, supportsCodeOnly: false, filesChanged: changes.map(change => change.file).filter(Boolean),
    insertions: changes.reduce((total, change) => total + change.additions, 0), deletions: changes.reduce((total, change) => total + change.deletions, 0) }
}

/** A native session stays observable between turns; the host reaper owns its lifetime. */
export function createManagedOpenCodeTurnRunner(
  resolveProjectPath: (projectId: string) => string | null,
  options: RunOpenCodeTurnOptions & { resolveLaunch?: (input: Input) => RunOpenCodeTurnOptions } = {},
): TurnRunner {
  const sessions = new Map<string, Promise<SessionHandle>>()
  const active = new Map<string, LiveSession>()

  async function open(input: Input, opts: RunOpenCodeTurnOptions, server: OpenCodeServerHandle, cwd: string) {
    const abort = new AbortController()
    const live: Partial<LiveSession> = {
      abort,
      signal: abort.signal,
      server,
      lastUsedAt: Date.now(),
      mapModel: opts.mapModel,
      providerModels: opts.providerModels,
      launchKey: launchKey(opts, cwd),
      publish: (event) => input.onAmbientEvent?.(event),
    }
    const emit = (event: AgentEvent) => live.publish?.(event)
    const onEvent = (event: OpenCodeRuntimeEvent) => {
      if (abort.signal.aborted) return
      if (event.type === 'runtime.connection')
        emit({ type: 'harness_connection_changed', connection: event.properties })
      else if (event.type === 'runtime.inbox') emit({ type: 'session_inbox_changed', items: event.properties.items })
      else if (event.type === 'runtime.resources') publishCatalog(live as LiveSession)
      else if (event.type === 'runtime.interrupted') live.active?.finish(undefined, true)
      else if (event.type === 'runtime.interactions') {
        if (live.active)
          live.active.resolveInteractions(event.properties.resolvedPermissions, event.properties.resolvedForms)
        else
          for (const requestId of event.properties.resolvedForms)
            emit({ type: 'interaction_resolved', interactionType: 'question', requestId })
      } else if (event.type === 'runtime.error') live.active?.finish(new Error(event.properties.message))
      else if (event.type === 'v2') {
        live.gate?.observe(event.event)
        if (live.active) live.active.apply(event.event, event.replay)
        else if (event.event.type === 'form.replied' || event.event.type === 'form.cancelled') {
          emit({ type: 'interaction_resolved', interactionType: 'question', requestId: event.event.data.id })
        } else if (event.event.type === 'form.created' && live.host) {
          const form = event.event.data.form,
            host = live.host
          void answerOpenCodeForm(form, (request) => host.onQuestion(request, abort.signal))
            .then(async (answers) => {
              abort.signal.throwIfAborted()
              host.assertControl()
              if (answers) await live.runtime!.questionReply(form.id, answers)
              else await live.runtime!.questionReject(form.id)
            })
            .catch(() => {
              void live.runtime?.questionReject(form.id).catch(() => {})
            })
        }
      }
    }
    try {
      const client = new OpenCodeV2Client({ baseUrl: server.url, directory: cwd, password: server.password })
      if (server.reused && input.session.providerResume?.startsWith('opencode:')) {
        const id = input.session.providerResume.slice(9)
        const session = await client.getSession(id)
        if (session.location.directory !== client.directory) throw new Error('Native OpenCode session belongs to another directory')
        // A recovered owned process may still execute the pre-crash input. Stop
        // that execution before accepting a fresh turn; never resubmit its text.
        await client.interrupt(id)
      }
      const runtime = await createOpenCodeV2Runtime(
        server,
        {
          sessionId: input.session.sessionId,
          cwd,
          config: {
            ...opts,
            binaryPath: opts.binaryPath ?? undefined,
            serverUrl: opts.serverUrl ?? undefined,
            serverPassword: opts.serverPassword ?? undefined,
          },
          providerSessionId: input.session.providerResume?.startsWith('opencode:')
            ? input.session.providerResume.slice(9)
            : undefined,
          permissionMode: input.permissionMode === 'plan' ? 'plan' : 'default',
          signal: input.signal,
          onEvent,
        },
        {
          createClient: () => client,
          attachmentTurn: (images, text) => openCodeAttachmentTurn(images, text, false),
          buildOpenCodeHostPermissionRules,
          reconcileOpenCodePermissions,
          syncMcpServers: async (registrar) => {
            const host = opts.getSuperoneMcp?.(input.session.sessionId) ?? opts.superoneMcp
            if (!host) return new Set()
            await registrar.add('superone', {
              type: 'remote',
              url: host.url,
              headers: host.headers,
              disabled: false,
              codemode: false,
            })
            return new Set(['superone'])
          },
          openUrl: async (url, context) => {
            if (!live.host) throw new Error('OpenCode sign-in needs an available controller')
            await openRemoteOpenCodeSignIn(url, context, live.host)
          },
          assertOAuthControl: () => {
            if (!live.host) throw new Error('OpenCode sign-in no longer has a controller')
            live.host.assertControl()
          },
        },
      )
      const ready: LiveSession = Object.assign(live, { runtime, client }) as LiveSession
      active.set(input.session.sessionId, ready)
      return ready
    } catch (error) {
      abort.abort()
      await server.close().catch(() => {})
      throw error
    }
  }

  function publishCatalog(live: LiveSession) {
    if (!live.runtime) return
    live.publish({
      type: 'session_agents',
      agents: live.runtime.agents,
      commands: live.runtime.commands,
      models: live.providerModels ?? live.runtime.models,
      runtimeCapabilities: {
        harnessId: 'opencode',
        supportsQueuedSteer: true,
        supportsQueuedSteerSoon: false,
        supportsStreamingToolInput: true,
      },
    })
  }

  async function run(input: Input, live: LiveSession) {
    input = { ...input, messageId: input.messageId ?? `opencode-${live.runtime.sessionId}-${crypto.randomUUID()}` }
    if (live.mapModel) input = { ...input, model: live.mapModel(input.model) }
    input.signal.throwIfAborted()
    if (live.active) throw new Error('OpenCode already has an active turn')
    live.lastUsedAt = Date.now()
    live.publish = (event) => input.onAmbientEvent?.(event)
    const turnAbort = new AbortController(),
      signal = AbortSignal.any([input.signal, turnAbort.signal, live.signal])
    let resolve!: () => void, reject!: (error: Error) => void
    const finished = new Promise<void>((done, fail) => {
      resolve = done
      reject = fail
    })
    void finished.catch(() => {})
    const gate = new OpenCodeSteeringGate(() => { if (live.gate === gate) live.active?.finish() }, event => input.onAgentEvent?.(event))
    live.gate = gate
    let admitted!: () => void, rejectAdmission!: (error: unknown) => void
    const firstAdmission = new Promise<void>((resolve, reject) => { admitted = resolve; rejectAdmission = reject })
    void firstAdmission.catch(() => {})
    live.admission = firstAdmission
    const events = new NodeOpenCodeV2Events(
      { ...input, ...(input.onAgentEvent ? { onAgentEvent: (event: AgentEvent) => { if (!gate.buffer(event)) input.onAgentEvent?.(event) } } : {}) },
      live.client,
      live.runtime.sessionId,
      signal,
      (error) => (error ? reject(error) : resolve()),
      (model) => live.runtime.models.find((item) => item.id === model)?.contextWindow,
      { questionReply: (id, answers) => live.runtime.questionReply(id, answers),
        questionReject: id => live.runtime.questionReject(id),
        permissionReply: (id, decision) => live.runtime.permissionReply(id, decision),
        holdCompletion: interrupted => gate.hold(interrupted), onInputAdmitted: admitted },
    )
    live.active = events
    let cancellation: Promise<void> | undefined
    const cancel = () => {
      cancellation ??= live.runtime.cancel().catch(() => {})
      events.finish(undefined, true)
    }
    input.signal.addEventListener('abort', cancel, { once: true })
    try {
      input.onProviderResume?.(`opencode:${live.runtime.sessionId}`)
      events.emit({
        type: 'message_start',
        message: {
          id: input.messageId!,
          role: 'assistant',
          status: 'streaming',
          content: [],
          providerId: 'opencode',
          createdAt: new Date().toISOString(),
        },
      })
      events.emit({ type: 'status_change', status: 'streaming' })
      events.emit({ type: 'provider_session_id', providerSessionId: live.runtime.sessionId })
      publishCatalog(live)
      for (const event of live.runtime.snapshotEvents) if (event.type === 'v2') events.apply(event.event, true)
      await live.runtime.prepareTurn?.(input.clientMessageId, {
        signal,
        assertControl: () => signal.throwIfAborted(),
        onInputAccepted: input.onInputAccepted,
      })
      const images: ImageAttachment[] = (input.images ?? []).map((image, index) => ({
        ...image,
        id: image.id ?? `attachment-${index}`,
        name: image.name ?? 'Attachment',
        path: image.originalPath ?? '',
      }))
      const invocation = resolveOpenCodeCommandInvocation(input.text, live.runtime.commands)
      const agent = input.agent ?? input.session.agent ?? undefined
      const dispatch = input.text.startsWith('!')
        ? input.text.slice(1).trim() && !images.length
          ? live.runtime.shell(input.text.slice(1).trimStart(), input.model ?? undefined, agent)
          : Promise.reject(new Error('OpenCode shell commands require a command and no attachments'))
        : input.text.trim() === '/compact'
          ? live.runtime.compact(input.model ?? undefined)
          : input.text.trim() === '/init'
            ? live.runtime.init(input.model ?? undefined)
            : /^\/(share|unshare)(?:\s|$)/.test(input.text.trim())
              ? Promise.reject(new Error('Session sharing is not available with OpenCode V2'))
              : invocation && !invocation.skillId
                ? live.runtime.command(
                    invocation.name,
                    invocation.arguments,
                    input.model ?? undefined,
                    input.effort as EffortLevel,
                    images,
                    agent,
                  )
                : live.runtime.prompt(
                    invocation?.skillId ? (invocation.arguments ?? '') : input.text,
                    input.model ?? undefined,
                    input.effort as EffortLevel,
                    images,
                    agent,
                    invocation?.skillId ? [invocation.skillId] : undefined,
                  )
      void dispatch.then(admitted, rejectAdmission)
      await waitForOpenCodeTurn(dispatch, finished)
      input.signal.throwIfAborted()
      if (live.runtime.agent)
        live.publish({ type: 'agent_setting_change', patch: { openCodeAgentId: live.runtime.agent } })
      return { finalText: events.text, providerResume: `opencode:${live.runtime.sessionId}` }
    } catch (error) {
      if (events.succeeded && !input.signal.aborted)
        return { finalText: events.text, providerResume: `opencode:${live.runtime.sessionId}` }
      events.finish(
        input.signal.aborted ? undefined : error instanceof Error ? error : new Error(String(error)),
        input.signal.aborted,
      )
      throw error
    } finally {
      input.signal.removeEventListener('abort', cancel)
      if (input.signal.aborted) { cancel(); await cancellation }
      rejectAdmission(new Error('OpenCode turn ended before input admission'))
      turnAbort.abort()
      gate.clear(); live.gate = undefined; live.admission = undefined
      live.active = undefined
      live.runtime.finishTurn?.()
      live.lastUsedAt = Date.now()
    }
  }

  const runner: TurnRunner = async (input) => {
    const id = input.session.sessionId
    const opts = { ...options, ...options.resolveLaunch?.(input) }
    const cwd = input.session.cwd?.trim() || resolveProjectPath(input.session.projectId) || process.cwd()
    const signature = launchKey(opts, cwd)
    const existing = active.get(id)
    if (existing && existing.launchKey !== signature) {
      if (existing.active || existing.host) throw new Error('Wait for OpenCode to become idle before changing its provider or launch configuration')
      await runner.disposeSession!(id)
    }
    let pending = sessions.get(id)
    if (!pending) {
      if (!isOpenCodeBinaryRunnable(opts.binaryPath) && !opts.serverUrl?.trim())
        throw new Error(
          'OpenCode runtime client not available on node: enable the harness with a real binary or endpoint',
        )
      pending = startOpenCodeSessionServer({ ...opts, sessionId: id, nativeSessionId: input.session.providerResume?.startsWith('opencode:') ? input.session.providerResume.slice(9) : undefined,
        hostMcp: opts.getSuperoneMcp?.(id) ?? opts.superoneMcp, cwd, signal: input.signal, timeoutMs: opts.startupTimeoutMs }).then(
        async (server) => {
          if (server.protocol !== 'v2') {
            try {
              if (opts.mapModel) throw new Error('Node provider-store credentials require OpenCode V2')
              return { legacy: await runOpenCodeV1Turn(input, server, cwd, opts) }
            } finally {
              await server.close()
            }
          }
          const live = await open(input, opts, server, cwd)
          live.launchKey = signature
          return live
        },
      )
      sessions.set(id, pending)
    }
    const live = await pending.catch((error) => {
      sessions.delete(id)
      throw error
    })
    if ('legacy' in live) {
      sessions.delete(id)
      return live.legacy
    }
    return run(input, live)
  }
  runner.steer = async (session, input, delivery) => {
    const live = active.get(session.sessionId), turn = live?.active, gate = live?.gate
    if (!live || !turn || !gate || !live.runtime.steer) throw new Error('Queued input can only steer an active OpenCode V2 turn')
    gate.begin()
    let submitted = false
    try {
      if (live.admission) await live.admission
      const id = await live.runtime.steer({ content: input.text, clientMessageId: input.clientMessageId,
        model: live.mapModel ? live.mapModel(input.model) : input.model ?? undefined, effort: input.effort as EffortLevel, agent: input.agent ?? undefined,
        images: input.images?.map((image, index) => ({ ...image, id: image.id ?? `attachment-${index}`,
          name: image.name ?? 'Attachment', path: image.originalPath ?? '' })) }, () => {
        if (live.active !== turn || turn.ended || live.signal.aborted) throw new Error('OpenCode turn ended before steering submission')
        submitted = true; delivery.onInputAccepted()
      }, delivery.assertControl)
      gate.admitted(id)
      delivery.onConsumed(); gate.consumed()
    } catch (error) {
      if (submitted && (gate.wasAdmitted(input.clientMessageId) || !openCodeSteerWasRejected(error))) { delivery.onConsumed(); gate.consumed() }
      else gate.rejected(input.clientMessageId)
      throw error
    } finally { gate.end() }
  }
  runner.callOperation = async (session, method, input, host) => {
    let live = active.get(session.sessionId)
    if (!live && method === 'session.previewRewind' && session.providerResume?.startsWith('opencode:')) {
      const signal = AbortSignal.timeout(15_000)
      const opts = { ...options, ...options.resolveLaunch?.({ session, text: '', onDelta: () => {}, signal }) }
      if (!isOpenCodeBinaryRunnable(opts.binaryPath) && !opts.serverUrl?.trim()) throw new Error('OpenCode runtime is unavailable')
      const cwd = session.cwd?.trim() || resolveProjectPath(session.projectId) || process.cwd()
      const server = await startOpenCodeSessionServer({ ...opts, sessionId: session.sessionId,
        nativeSessionId: session.providerResume.slice(9), admin: true, cwd, signal })
      try {
        if (server.protocol !== 'v2') throw new Error('Native checkpoints require OpenCode V2')
        const client = new OpenCodeV2Client({ baseUrl: server.url, password: server.password, directory: cwd, signal })
        const id = session.providerResume.slice(9), native = await client.getSession(id)
        if (native.location.directory !== client.directory) throw new Error('Native OpenCode session belongs to another directory')
        const messages = await client.messages(id, { order: 'asc' })
        if (!messages.some(message => message.type === 'user' && message.id === input.checkpointId)) throw new Error('Native checkpoint is unavailable')
        return rewindSummary(await client.diff(id, String(input.checkpointId)))
      } finally { await server.close() }
    }
    if (!live && ['session.rewind', 'session.truncateAtCheckpoint'].includes(method) && session.providerResume?.startsWith('opencode:')) {
      host.assertControl()
      const signal = new AbortController().signal
      const connection: Input = { session, text: '', onDelta: () => {}, onAmbientEvent: host.onEvent, signal }
      const opts = { ...options, ...options.resolveLaunch?.(connection) }
      const cwd = session.cwd?.trim() || resolveProjectPath(session.projectId) || process.cwd()
      if (!isOpenCodeBinaryRunnable(opts.binaryPath) && !opts.serverUrl?.trim()) throw new Error('OpenCode runtime is unavailable')
      const pending = sessions.get(session.sessionId) ?? startOpenCodeSessionServer({ ...opts, sessionId: session.sessionId,
        nativeSessionId: session.providerResume.slice(9), hostMcp: opts.getSuperoneMcp?.(session.sessionId) ?? opts.superoneMcp, cwd, signal }).then(async server => {
        if (server.protocol !== 'v2') { await server.close(); throw new Error('Native checkpoints require OpenCode V2') }
        return open(connection, opts, server, cwd)
      })
      sessions.set(session.sessionId, pending)
      const handle = await pending
      if (!('legacy' in handle)) live = handle
    }
    if (!live) {
      if (method === 'session.inbox.list' || method === 'session.mcpStatus') return []
      if (method === 'session.contextUsage') return null
      throw Object.assign(new Error('This operation needs a connected OpenCode V2 session'), {
        code: 'failed_precondition',
      })
    }
    live.lastUsedAt = Date.now()
    switch (method) {
      case 'session.inbox.list':
        return live.runtime.listInbox!()
      case 'session.inbox.cancel':
        await live.runtime.cancelInbox!(String(input.inboxId), host.assertControl)
        return { ok: true }
      case 'session.inbox.update':
        if (live.active && live.gate && input.delivery === 'steer') {
          const owned = live, turn = live.active, gate = live.gate
          const native = (await live.client.inbox(live.runtime.sessionId, live.signal)).find(item => item.id === input.inboxId && item.type === 'user')
          if (!native || native.type !== 'user') throw new Error('This input is no longer pending')
          const userId = typeof native.payload.metadata?.superoneClientMessageId === 'string' ? native.payload.metadata.superoneClientMessageId : `opencode-${native.id}`
          const adopted = () => {
            turn.adoptInbox(native.id)
            host.onEvent({ type: 'user_message_appended', message: { id: userId, role: 'user', status: 'complete', providerId: 'opencode',
              content: [{ type: 'text', text: native.payload.text }], createdAt: new Date(native.time.created).toISOString(), checkpointId: native.id } })
            turn.emit({ type: 'checkpoint_captured', messageId: turn.messageId, userMessageId: userId, checkpointId: native.id, resumePointId: native.id })
            gate.consumed()
          }
          gate.begin()
          let submitted = false
          try {
            await owned.admission
            await owned.runtime.updateInbox!(native.id, 'steer', () => {
              host.assertControl()
              if (owned.active !== turn || turn.ended) throw new Error('OpenCode turn ended before inbox update')
              submitted = true; gate.admitted(native.id)
            })
            adopted()
            return { ok: true }
          } catch (error) {
            if (!submitted || openCodeSteerWasRejected(error)) gate.withdraw(native.id)
            else adopted()
            throw error
          } finally { gate.end() }
        }
        if (!live.active && input.delivery === 'steer') {
          if (live.host) throw new Error('Finish OpenCode sign-in before starting inbox input')
          const native = (await live.client.inbox(live.runtime.sessionId, live.signal)).find(item => item.id === input.inboxId && item.type === 'user')
          if (!native || native.type !== 'user') throw new Error('This input is no longer pending')
          host.assertControl()
          await live.runtime.prepareTurn?.(undefined, { assertControl: host.assertControl })
          const id = typeof native.payload.metadata?.superoneClientMessageId === 'string' ? native.payload.metadata.superoneClientMessageId : `opencode-${native.id}`
          const messageId = crypto.randomUUID(), owned = live, abort = new AbortController()
          owned.ambientAbort = abort
          const events = new NodeOpenCodeV2Events({ session, text: native.payload.text, messageId,
            onDelta: () => {}, onAgentEvent: host.onEvent,
            onQuestion: request => host.onQuestion(request, abort.signal), onPermission: request => host.onPermission(request, abort.signal),
            signal: AbortSignal.any([live.signal, abort.signal]) }, live.client, live.runtime.sessionId,
            AbortSignal.any([live.signal, abort.signal]), () => {
              if (owned.active === events) { owned.active = undefined; owned.ambientAbort = undefined; owned.runtime.finishTurn?.(); abort.abort() }
            }, model => live!.runtime.models.find(item => item.id === model)?.contextWindow,
            { questionReply: (id, answers) => owned.runtime.questionReply(id, answers), questionReject: id => owned.runtime.questionReject(id),
              permissionReply: (id, decision) => owned.runtime.permissionReply(id, decision) })
          live.active = events
          events.adoptInbox(native.id)
          host.onEvent({ type: 'user_message_appended', message: { id, role: 'user', status: 'complete', providerId: 'opencode',
            content: [{ type: 'text', text: native.payload.text }], createdAt: new Date(native.time.created).toISOString(), checkpointId: native.id } })
          events.emit({ type: 'message_start', message: { id: messageId, role: 'assistant', providerId: 'opencode', content: [],
            status: 'streaming', createdAt: new Date().toISOString() } })
          try { await owned.runtime.updateInbox!(native.id, 'steer', host.assertControl) }
          catch (error) { events.finish(error instanceof Error ? error : new Error(String(error))); throw error }
          return { ok: true }
        }
        await live.runtime.updateInbox!(String(input.inboxId), input.delivery as 'steer' | 'queue', host.assertControl)
        return { ok: true }
      case 'session.previewRewind':
      case 'session.rewind':
      case 'session.truncateAtCheckpoint': {
        if (live.active || live.host) throw new Error('Wait for OpenCode to become idle before rewinding')
        if (method === 'session.rewind' && input.mode === 'files') return { canRewind: false, supportsCodeOnly: false, error: 'OpenCode rewinds files together with its conversation' }
        const checkpoint = String(input.checkpointId)
        const native = await live.client.messages(live.runtime.sessionId, { order: 'asc' })
        const boundary = native.findIndex(message => message.id === checkpoint && message.type === 'user')
        if (boundary < 0) throw new Error('Native checkpoint is unavailable; reload the session')
        const changes = await live.runtime.diff(checkpoint)
        const result = rewindSummary(changes)
        if (method !== 'session.previewRewind') {
          await live.client.revertStage(live.runtime.sessionId, checkpoint, host.assertControl, method === 'session.rewind' && input.mode === 'code+chat')
          host.onEvent({ type: 'transcript_replaced', messages: projectOpenCodeHistory(live.runtime.sessionId, native.slice(0, boundary), host.messages) })
        }
        return method === 'session.truncateAtCheckpoint' ? true : result
      }
      case 'session.connection.reconnect':
        await live.runtime.reconnect!()
        return { ok: true }
      case 'session.contextUsage':
        return live.runtime.getContextUsage()
      case 'session.mcpStatus':
        return live.runtime.getMcpServerStatus()
      case 'session.refreshResources': {
        if (live.active)
          throw Object.assign(new Error('Wait for the OpenCode turn to finish before refreshing'), {
            code: 'failed_precondition',
          })
        const resources = await live.runtime.refreshResources!(host.assertControl)
        publishCatalog(live)
        return { opencode: { ...resources, models: live.providerModels ?? resources.models } }
      }
      case 'session.mcpAuthenticate': {
        if (live.active) throw new Error('Wait for the OpenCode turn to finish before signing in')
        if (live.host) throw new Error('Another OpenCode sign-in is already running')
        live.host = host
        try {
          host.assertControl()
          await live.runtime.authenticateMcp(String(input.serverName), host.assertControl)
          return null
        } finally {
          live.host = undefined
        }
      }
      default:
        throw Object.assign(new Error(`Unsupported OpenCode operation: ${method}`), { code: 'unsupported' })
    }
  }
  runner.servedOperations = new Set([
    'session.dequeue', 'session.steer',
    'session.inbox.list',
    'session.inbox.cancel',
    'session.inbox.update',
    'session.previewRewind', 'session.rewind', 'session.truncateAtCheckpoint',
    'session.contextUsage',
    'session.mcpStatus',
    'session.mcpAuthenticate',
    'session.connection.reconnect',
    'session.refreshResources',
  ])
  runner.interruptSession = async id => {
    const live = active.get(id)
    if (!live?.ambientAbort) return
    const events = live.active
    live.ambientAbort.abort()
    await live.runtime.cancel().catch(() => {})
    events?.finish(undefined, true)
  }
  runner.disposeSession = async (id) => {
    const pending = sessions.get(id)
    sessions.delete(id)
    const live = await pending?.catch(() => null)
    if (live && !('legacy' in live)) {
      live.abort.abort()
      await live.runtime.close()
      active.delete(id)
    }
  }
  runner.disposeAll = async () => {
    await Promise.all([...sessions.keys()].map((id) => runner.disposeSession!(id)))
  }
  runner.listActiveRuntimes = () =>
    [...active].map(([sessionId, live]) => ({
      sessionId,
      harnessId: 'opencode',
      lastActivityAt: live.lastUsedAt,
      busy: !!live.active || !!live.host || !!live.runtime.hasPendingAuthentication,
    }))
  return runner
}

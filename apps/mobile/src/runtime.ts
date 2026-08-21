import type {
  AgentEvent,
  ChatMessage,
  HarnessId,
  ImageAttachment,
  PermissionRequest,
  RemoteCommand,
} from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultPerSessionState } from '@superone/chat-core'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import type { RelayClient } from '@superone/relay-client'
import { restoreSession } from '@superone/relay-client'
import { randomId } from './ids'

type SessionState = ReturnType<typeof createDefaultPerSessionState>

export type SystemInfo = {
  models?: { id?: string; name?: string }[]
  userSlashCommands?: unknown[]
  slashCommands?: unknown[]
  permissionModes?: string[]
  permissionPresets?: string[]
  account?: unknown
  defaults?: { model?: string | null; permissionMode?: string | null; effort?: string | null }
  error?: string
}

export class ChatRuntime {
  session: SessionState = createDefaultPerSessionState()
  projectPath = ''
  sessionId = ''
  provider: HarnessId | string = 'claude'
  slashCommands: unknown[] = []
  permissionModes: string[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
  models: { id?: string; name?: string }[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (session: SessionState) => void,
  ) {}

  async open(projectPath: string, sessionId: string): Promise<void> {
    this.projectPath = projectPath
    this.sessionId = sessionId
    this.session = createDefaultPerSessionState()
    const restored = await restoreSession(this.client, projectPath, sessionId)
    this.session.messages = restored.messages
    if (restored.provider) this.session.sessionProvider = restored.provider as SessionState['sessionProvider']
    if (restored.provider) this.provider = restored.provider
    if (restored.snapshot.permissionMode) {
      this.session.permissionMode = restored.snapshot.permissionMode as SessionState['permissionMode']
    }
    if (restored.snapshot.status === 'streaming' || restored.snapshot.status === 'idle') {
      this.session.status = restored.snapshot.status
    }
    for (const msg of restored.snapshot.inProgressMessages ?? []) {
      if (!this.session.messages.some((m) => m.id === msg.id)) this.session.messages.push(msg)
    }
    for (const ev of restored.snapshot.pendingInteractions ?? []) {
      this.apply(ev)
    }
    for (const batch of restored.liveBatches) {
      for (const ev of batch) this.apply(ev as AgentEvent)
    }
    this.flush()
  }

  reopen(): Promise<void> {
    if (!this.projectPath || !this.sessionId) return Promise.resolve()
    return this.open(this.projectPath, this.sessionId)
  }

  async create(projectPath: string, opts: { provider?: string; permissionMode?: string; model?: string } = {}): Promise<string> {
    const sessionId = randomId()
    const res = await this.client.request({
      type: 'create_session',
      requestId: randomId(),
      sessionId,
      projectPath,
      ...(opts.provider ? { provider: opts.provider as HarnessId } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.model ? { model: opts.model } : {}),
    } as RemoteCommand) as { ok?: boolean; sessionId?: string; error?: string }
    if (res.error || res.ok === false) throw new Error(res.error ?? 'create_session failed')
    const id = res.sessionId ?? sessionId
    await this.open(projectPath, id)
    return id
  }

  async loadSystemInfo(provider: string = String(this.provider)): Promise<SystemInfo> {
    if (!this.projectPath) return {}
    const info = await this.client.request({
      type: 'get_system_info',
      requestId: randomId(),
      projectPath: this.projectPath,
      provider: provider as HarnessId,
    } as RemoteCommand) as SystemInfo
    this.provider = provider
    this.slashCommands = info.userSlashCommands ?? info.slashCommands ?? []
    if (info.permissionModes?.length) this.permissionModes = info.permissionModes
    else if (info.permissionPresets?.length) this.permissionModes = info.permissionPresets
    this.models = info.models ?? []
    if (info.defaults?.permissionMode && !this.session.permissionMode) {
      this.session.permissionMode = info.defaults.permissionMode as SessionState['permissionMode']
    }
    return info
  }

  ingest(events: unknown[]): void {
    for (const ev of events) this.apply(ev as AgentEvent)
    this.schedule()
  }

  send(content: string, extra: { images?: ImageAttachment[] } = {}): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'send_message',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      content,
      ...(extra.images?.length ? { images: extra.images } : {}),
    }
    return this.client.request(cmd)
  }

  interrupt(): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'interrupt',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    return this.client.request(cmd)
  }

  setPermissionMode(mode: string): void {
    this.session.permissionMode = mode as SessionState['permissionMode']
    this.client.send({
      type: 'set_permission_mode',
      mode,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    })
  }

  searchMentions(query: string): Promise<{ items?: unknown[]; error?: string }> {
    return this.client.request({
      type: 'search_mentions',
      requestId: randomId(),
      projectPath: this.projectPath,
      query,
    } as RemoteCommand) as Promise<{ items?: unknown[]; error?: string }>
  }

  respondPermission(requestId: string, decision: boolean): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'respond_permission',
      requestId,
      decision,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    return this.client.request(cmd)
  }

  respondPlan(requestId: string, approved: boolean, feedback?: string): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'respond_plan_approval',
      requestId,
      approved,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(feedback ? { feedback } : {}),
    }
    return this.client.request(cmd)
  }

  answerQuestion(requestId: string, answers: Record<string, string>): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'answer_question',
      requestId,
      answers,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    return this.client.request(cmd)
  }

  dismissQuestion(requestId: string): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'dismiss_question',
      requestId,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    return this.client.request(cmd)
  }

  get pendingPermission(): PermissionRequest | undefined {
    return this.session.pendingPermissions[0]
  }

  get messages(): ChatMessage[] {
    return this.session.messages
  }

  get streaming(): boolean {
    return this.session.status === 'streaming' || this.session.awaitingAssistantReply
  }

  get permissionMode(): string {
    return String(this.session.permissionMode ?? 'default')
  }

  get todos(): SessionState['todos'] {
    return this.session.todos
  }

  private apply(event: AgentEvent): void {
    const patch = applyEventToSession(this.session, event)
    this.session = { ...this.session, ...patch }
    this.dirty = true
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, AGENT_EVENT_BATCH_MS)
  }

  flush(): void {
    if (!this.dirty) return
    this.dirty = false
    this.onPaint(this.session)
  }
}

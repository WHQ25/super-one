import type {
  AgentEvent,
  ChatMessage,
  HarnessId,
  ImageAttachment,
  PermissionRequest,
  RemoteCommand,
  RemoteSystemInfo,
} from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultChatCoreSession } from '@superone/chat-core'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import type { RelayClient } from '@superone/relay-client'
import { restoreSession } from '@superone/relay-client'
import { randomId } from './ids'
import { mergeSlashCatalogs } from './slash'

type SessionState = ReturnType<typeof createDefaultChatCoreSession>
type SharedFileEvent = Extract<AgentEvent, { type: 'shared_file' }>
type SharedFileProgressEvent = Extract<AgentEvent, { type: 'shared_file_progress' }>

export type ChatRuntimeHooks = {
  onSharedFile?: (event: SharedFileEvent) => void
  onSharedFileProgress?: (event: SharedFileProgressEvent) => void
}

export type SystemInfo = RemoteSystemInfo

export type CreateSessionOptions = {
  provider?: HarnessId
  acpAgentId?: string
  permissionMode?: string
  effort?: string
  model?: string
  gitBranch?: string
  worktreePath?: string
  worktreeBranch?: string
  worktreeMode?: 'branch' | 'attach' | 'detach'
  worktreeBranchName?: string
  worktreeCarryLocalChanges?: boolean
  additionalDirectories?: string[]
}

export class ChatRuntime {
  session: SessionState = createDefaultChatCoreSession()
  projectPath = ''
  sessionId = ''
  provider: HarnessId | string = 'claude'
  slashCommands: unknown[] = []
  permissionModes: string[] = ['default', 'acceptEdits', 'plan', 'bypassPermissions']
  sessionTitle = ''
  models: { id?: string; name?: string }[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false
  private eventEpoch = 0
  private restoreGeneration = 0
  private restoreQueue: Promise<void> = Promise.resolve()

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (session: SessionState) => void,
    private readonly hooks: ChatRuntimeHooks = {},
  ) {}

  async open(projectPath: string, sessionId: string): Promise<void> {
    this.projectPath = projectPath
    this.sessionId = sessionId
    const generation = ++this.restoreGeneration
    const restore = this.restoreQueue.then(async () => {
      if (generation !== this.restoreGeneration) return
      const restored = await restoreSession(this.client, projectPath, sessionId)
      if (generation !== this.restoreGeneration) return
      let session = createDefaultChatCoreSession()
      session.messages = [...restored.messages]
      if (restored.provider) session.sessionProvider = restored.provider as SessionState['sessionProvider']
      if (restored.snapshot.permissionMode) {
        session.permissionMode = restored.snapshot.permissionMode as SessionState['permissionMode']
      }
      if (restored.snapshot.status === 'streaming' || restored.snapshot.status === 'idle') {
        session.status = restored.snapshot.status
      }
      for (const msg of restored.snapshot.inProgressMessages ?? []) {
        if (!session.messages.some((m) => m.id === msg.id)) session.messages.push(msg)
      }
      const restoreEvents = [
        ...(restored.snapshot.pendingInteractions ?? []),
        ...restored.liveBatches.flat() as AgentEvent[],
      ]
      for (const event of restoreEvents) {
        if (!this.handleSideEvent(event)) session = this.reduce(session, event)
      }
      this.session = session
      this.eventEpoch = restored.epoch
      if (restored.provider) this.provider = restored.provider
      this.dirty = true
      this.flush()
    })
    this.restoreQueue = restore.catch(() => {})
    await restore
  }

  reopen(): Promise<void> {
    if (!this.projectPath || !this.sessionId) return Promise.resolve()
    return this.open(this.projectPath, this.sessionId)
  }

  async create(projectPath: string, opts: CreateSessionOptions = {}): Promise<string> {
    const sessionId = randomId()
    if (opts.provider) this.provider = opts.provider
    const res = await this.client.request({
      type: 'create_session',
      requestId: randomId(),
      sessionId,
      projectPath,
      ...(opts.provider ? { provider: opts.provider as HarnessId } : {}),
      ...(opts.acpAgentId ? { acpAgentId: opts.acpAgentId } : {}),
      ...(opts.permissionMode ? { permissionMode: opts.permissionMode } : {}),
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.gitBranch ? { gitBranch: opts.gitBranch } : {}),
      ...(opts.worktreePath ? { worktreePath: opts.worktreePath } : {}),
      ...(opts.worktreeBranch ? { worktreeBranch: opts.worktreeBranch } : {}),
      ...(opts.worktreeMode ? { worktreeMode: opts.worktreeMode } : {}),
      ...(opts.worktreeBranchName ? { worktreeBranchName: opts.worktreeBranchName } : {}),
      ...(opts.worktreeCarryLocalChanges !== undefined
        ? { worktreeCarryLocalChanges: opts.worktreeCarryLocalChanges }
        : {}),
      ...(opts.additionalDirectories?.length
        ? { additionalDirectories: opts.additionalDirectories }
        : {}),
    } as RemoteCommand) as { ok?: boolean; sessionId?: string; error?: string }
    if (res.error || res.ok === false) throw new Error(res.error ?? 'create_session failed')
    const id = res.sessionId ?? sessionId
    await this.open(projectPath, id)
    return id
  }

  async loadSystemInfo(provider: string = String(this.provider)): Promise<SystemInfo> {
    if (!this.projectPath) return {}
    const [info, projectResources] = await Promise.all([
      this.client.request({
        type: 'get_system_info',
        requestId: randomId(),
        projectPath: this.projectPath,
        provider: provider as HarnessId,
      } as RemoteCommand) as Promise<SystemInfo>,
      this.client.request({
        type: 'get_project_resources',
        requestId: randomId(),
        projectPath: this.projectPath,
        provider: provider as HarnessId,
      } as RemoteCommand).catch(() => ({})) as Promise<{
        projectSlashCommands?: unknown[]
        skills?: unknown[]
      }>,
    ])
    this.provider = provider
    this.slashCommands = mergeSlashCatalogs(
      info.userSlashCommands ?? info.slashCommands ?? [],
      projectResources.projectSlashCommands ?? [],
      projectResources.skills ?? [],
    )
    if (info.permissionModes?.length) this.permissionModes = info.permissionModes
    else if (info.permissionPresets?.length) this.permissionModes = info.permissionPresets
    this.models = info.models ?? []
    if (info.defaults?.permissionMode && !this.session.permissionMode) {
      this.session.permissionMode = info.defaults.permissionMode as SessionState['permissionMode']
    }
    return info
  }

  ingest(events: unknown[], epoch: number = this.eventEpoch): void {
    if (epoch !== this.eventEpoch) return
    for (const ev of events) this.apply(ev as AgentEvent)
    this.schedule()
  }

  get epoch(): number {
    return this.eventEpoch
  }

  dispose(): void {
    this.restoreGeneration += 1
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.dirty = false
  }

  send(content: string, extra: { images?: ImageAttachment[]; model?: string; effort?: string } = {}): void {
    const cmd: RemoteCommand = {
      type: 'send_message',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      content,
      provider: this.provider as HarnessId,
      ...(extra.model ? { model: extra.model } : {}),
      ...(extra.effort ? { effort: extra.effort } : {}),
      ...(extra.images?.length ? { images: extra.images } : {}),
    }
    this.client.send(cmd)
  }

  interrupt(): void {
    const cmd: RemoteCommand = {
      type: 'interrupt',
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
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

  respondPermission(
    requestId: string,
    decision: boolean,
    formAnswers?: Record<string, unknown>,
    alwaysAllow?: boolean,
    reason?: string,
  ): void {
    const cmd: RemoteCommand = {
      type: 'respond_permission',
      requestId,
      decision,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(alwaysAllow !== undefined ? { alwaysAllow } : {}),
      ...(reason ? { reason } : {}),
      ...(formAnswers ? { formAnswers } : {}),
    }
    this.client.send(cmd)
  }

  respondPlan(requestId: string, approved: boolean, feedback?: string): void {
    const cmd: RemoteCommand = {
      type: 'respond_plan_approval',
      requestId,
      approved,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
      ...(feedback ? { feedback } : {}),
    }
    this.client.send(cmd)
  }

  answerQuestion(requestId: string, answers: Record<string, string>): void {
    const cmd: RemoteCommand = {
      type: 'answer_question',
      requestId,
      answers,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
  }

  dismissQuestion(requestId: string): void {
    const cmd: RemoteCommand = {
      type: 'dismiss_question',
      requestId,
      sessionId: this.sessionId,
      projectPath: this.projectPath,
    }
    this.client.send(cmd)
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
    if (event.type === 'session_title_changed' && event.sessionId === this.sessionId) {
      this.sessionTitle = event.title
    }
    if (this.handleSideEvent(event)) return
    this.session = this.reduce(this.session, event)
    this.dirty = true
  }

  private handleSideEvent(event: AgentEvent): boolean {
    if (event.type === 'shared_file') {
      this.hooks.onSharedFile?.(event)
      return true
    }
    if (event.type === 'shared_file_progress') {
      this.hooks.onSharedFileProgress?.(event)
      return true
    }
    return false
  }

  private reduce(session: SessionState, event: AgentEvent): SessionState {
    const patch = applyEventToSession(session, event)
    return { ...session, ...patch }
  }

  private schedule(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, AGENT_EVENT_BATCH_MS)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (!this.dirty) return
    this.dirty = false
    this.onPaint(this.session)
  }
}

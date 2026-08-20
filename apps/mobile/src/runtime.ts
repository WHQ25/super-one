import type { AgentEvent, ChatMessage, PermissionRequest, RemoteCommand } from '@superone/shared/agent-types'
import { applyEventToSession, createDefaultPerSessionState } from '@superone/chat-core'
import { AGENT_EVENT_BATCH_MS } from '@superone/shared/agent-event-batcher'
import type { RelayClient } from '@superone/relay-client'
import { restoreSession } from '@superone/relay-client'

type SessionState = ReturnType<typeof createDefaultPerSessionState>

export class ChatRuntime {
  session: SessionState = createDefaultPerSessionState()
  private timer: ReturnType<typeof setTimeout> | null = null
  private dirty = false

  constructor(
    private readonly client: RelayClient,
    private readonly onPaint: (session: SessionState) => void,
  ) {}

  async open(projectPath: string, sessionId: string): Promise<void> {
    this.session = createDefaultPerSessionState()
    const restored = await restoreSession(this.client, projectPath, sessionId)
    this.session.messages = restored.messages
    if (restored.provider) this.session.sessionProvider = restored.provider as SessionState['sessionProvider']
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

  ingest(events: unknown[]): void {
    for (const ev of events) this.apply(ev as AgentEvent)
    this.schedule()
  }

  send(projectPath: string, sessionId: string, content: string): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'send_message',
      sessionId,
      projectPath,
      content,
    }
    return this.client.request(cmd)
  }

  respondPermission(sessionId: string, requestId: string, decision: boolean): Promise<unknown> {
    const cmd: RemoteCommand = {
      type: 'respond_permission',
      requestId,
      decision,
      sessionId,
    }
    return this.client.request(cmd)
  }

  get pendingPermission(): PermissionRequest | undefined {
    return this.session.pendingPermissions[0]
  }

  get messages(): ChatMessage[] {
    return this.session.messages
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

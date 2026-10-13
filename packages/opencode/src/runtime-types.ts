import type { Event as OpenCodeEvent } from '@opencode-ai/sdk/v2'
import type {
  ContextUsageInfo,
  EffortLevel,
  ImageAttachment,
  McpServerConfig,
  McpServerInfo,
  ModelOption,
  OpenCodeResources,
  PermissionMode,
  SlashCommandInfo,
  SendMessageRequest,
} from '@superone/shared/agent-types'
import type { OpenCodeV2Event } from './opencode-v2-types'

export interface OpenCodeRuntimeConfig {
  serviceHome?: string
  binaryPath?: string
  serverUrl?: string
  serverPassword?: string
  env?: Record<string, string>
  startupTimeoutMs?: number
}

/** 2.x events are wrapped: several share a `type` with 1.x events but not their shape. */
export type OpenCodeRuntimeEvent =
  | OpenCodeEvent
  | { type: 'runtime.resources'; properties: { resources: OpenCodeResources } }
  | {
      type: 'runtime.connection'
      properties: import('@superone/shared/session-inbox').HarnessConnectionState
    }
  | {
      type: 'runtime.inbox'
      properties: { items: import('@superone/shared/session-inbox').SessionInboxItem[] }
    }
  | {
      type: 'runtime.interactions'
      properties: { resolvedPermissions: string[]; resolvedForms: string[] }
    }
  | {
      type: 'runtime.error'
      properties: { message: string }
    }
  | { type: 'runtime.interrupted'; properties: { reason: string } }
  | {
      type: 'v2'
      event: OpenCodeV2Event
      replay?: boolean
    }

export interface OpenCodeFileChange {
  file?: string
  additions: number
  deletions: number
}

export interface OpenCodeRuntimeOptions {
  signal?: AbortSignal
  sessionId: string
  cwd: string
  config: OpenCodeRuntimeConfig
  providerSessionId?: string
  /** Legacy launch input, used only to restore a previously selected Plan agent. */
  permissionMode: PermissionMode
  onEvent: (event: OpenCodeRuntimeEvent) => void
  systemPromptAppend?: string
}

export interface OpenCodeRuntime {
  readonly sessionId: string
  readonly agent?: string
  readonly models: ModelOption[]
  readonly agents: Array<{ id: string; name: string; description?: string }>
  readonly commands: SlashCommandInfo[]
  /** Replayed once on attach: todos and interactions still pending on the session. */
  readonly snapshotEvents: OpenCodeRuntimeEvent[]
  setTitle(title: string): Promise<void>
  prompt(
    text: string,
    model?: string,
    effort?: EffortLevel,
    images?: ImageAttachment[],
    agent?: string,
    skills?: string[],
  ): Promise<void>
  /** Native V2 steering admission; no separate assistant turn is opened. */
  steer?(request: SendMessageRequest, onInputAccepted: () => void, assertControl?: () => void): Promise<string>
  supportsStreamingToolInput?: boolean
  refreshResources?(assertControl?: () => void): Promise<OpenCodeResources>
  hasPendingAuthentication?: boolean
  waitForConnection?(): Promise<void>
  reconnect?(): Promise<void>
  prepareTurn?(
    clientMessageId?: string,
    delivery?: { assertControl?: () => void; onInputAccepted?: () => void; signal?: AbortSignal },
  ): Promise<void>
  finishTurn?(): void
  listInbox?(): Promise<import('@superone/shared/session-inbox').SessionInboxItem[]>
  cancelInbox?(id: string, assertControl: () => void): Promise<void>
  updateInbox?(id: string, delivery: 'steer' | 'queue', assertControl: () => void): Promise<void>
  command(
    name: string,
    args?: string,
    model?: string,
    effort?: EffortLevel,
    images?: ImageAttachment[],
    agent?: string,
  ): Promise<void>
  shell(command: string, model?: string, agent?: string): Promise<void>
  init(model?: string): Promise<void>
  compact(model?: string): Promise<void>
  share(): Promise<string>
  unshare(): Promise<void>
  getContextUsage(): Promise<ContextUsageInfo | null>
  /** Files changed from the turn of user message `messageId` through the latest turn. */
  diff(messageId: string): Promise<OpenCodeFileChange[]>
  revert(messageId: string): Promise<void>
  unrevert(): Promise<void>
  setModel(model: string): Promise<void>
  cancel(): Promise<void>
  permissionReply(requestId: string, reply: 'once' | 'always' | 'reject'): Promise<void>
  questionReply(requestId: string, answers: string[][]): Promise<void>
  questionReject(requestId: string): Promise<void>
  getMcpServerStatus(): Promise<McpServerInfo[]>
  authenticateMcp(name: string, assertControl?: () => void): Promise<void>
  reconnectMcp(name: string): Promise<void>
  toggleMcpServer(name: string, enabled: boolean): Promise<void>
  reloadMcpServers(): Promise<void>
  close(): Promise<void>
}

export interface OpenCodeMcpRegistrar<T> {
  /** Null when the config cannot be registered (no command or URL). */
  toConfig(config: McpServerConfig, host: boolean): T | null
  add(name: string, config: T): Promise<void>
  disconnect(name: string): Promise<void>
}

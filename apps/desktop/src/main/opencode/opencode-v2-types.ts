/**
 * OpenCode 2.x HTTP API (`/api/*`) shapes SuperOne reads. Hand-written from the
 * 2.0.22 OpenAPI document and live event streams: npm has no SDK for this API yet.
 * Only the fields SuperOne uses are declared.
 */

export interface OpenCodeV2ModelRef {
  id: string
  providerID: string
  variant?: string
}

export interface OpenCodeV2Model {
  id: string
  providerID: string
  name: string
  enabled: boolean
  variants: Array<{ id: string }>
  limit: { context: number }
}

export interface OpenCodeV2Provider {
  id: string
  name: string
}

export interface OpenCodeV2Agent {
  id: string
  name: string
  description?: string
  model?: OpenCodeV2ModelRef
  mode: 'subagent' | 'primary' | 'all'
  hidden: boolean
}

export interface OpenCodeV2Command {
  name: string
  description?: string
}

export interface OpenCodeV2McpServer {
  name: string
  status:
    | { status: 'connected' | 'pending' | 'disabled' }
    | { status: 'failed' | 'needs_auth'; error: string }
}

export interface OpenCodeV2McpLocalConfig {
  type: 'local'
  command: string[]
  environment?: Record<string, string>
  disabled?: boolean
  codemode?: boolean
}

export interface OpenCodeV2McpRemoteConfig {
  type: 'remote'
  url: string
  headers?: Record<string, string>
  disabled?: boolean
  codemode?: boolean
}

export type OpenCodeV2McpConfig = OpenCodeV2McpLocalConfig | OpenCodeV2McpRemoteConfig

export interface OpenCodeV2PermissionRule {
  action: string
  resource: string
  effect: 'allow' | 'deny' | 'ask'
}

export interface OpenCodeV2TokenUsage {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface OpenCodeV2Session {
  id: string
  agent?: string
  permissions?: OpenCodeV2PermissionRule[]
  model?: OpenCodeV2ModelRef
  location: { directory: string }
}

export interface OpenCodeV2StructuredError {
  type: string
  message: string
}

export interface OpenCodeV2PermissionRequest {
  id: string
  sessionID: string
  action: string
  resources: string[]
  save?: string[]
  metadata?: Record<string, unknown>
  source?: { type: 'tool'; messageID: string; id: string }
}

export interface OpenCodeV2FormOption {
  value: string
  label: string
  description?: string
}

export interface OpenCodeV2FormField {
  key: string
  type: 'string' | 'number' | 'integer' | 'boolean' | 'multiselect' | 'external'
  title?: string
  description?: string
  required?: boolean
  hidden?: boolean
  options?: OpenCodeV2FormOption[]
}

export interface OpenCodeV2Form {
  id: string
  sessionID: string
  title: string
  fields: OpenCodeV2FormField[]
}

export type OpenCodeV2FormValue = string | number | boolean | string[]

export interface OpenCodeV2FileDiff {
  file: string
  additions: number
  deletions: number
}

export interface OpenCodeV2Shell {
  id: string
  command: string
  status: 'running' | 'exited' | 'timeout' | 'killed'
}

/** `assistant` messages carry `model`; tokens appear once a step has ended. */
export interface OpenCodeV2Message {
  type: string
  id: string
  model?: OpenCodeV2ModelRef
  tokens?: OpenCodeV2TokenUsage
}

type SessionScoped<T> = { sessionID: string } & T
type StepScoped<T> = SessionScoped<{ assistantMessageID: string } & T>

/**
 * `GET /api/event` frames: `{ id, type, created, data }`. Only consumed types are
 * listed; the stream carries many more, which consumers ignore by type.
 */
export type OpenCodeV2Event = { id: string; created?: number } & (
  | { type: 'session.execution.started' | 'session.execution.succeeded'; data: SessionScoped<object> }
  | { type: 'session.execution.failed'; data: SessionScoped<{ error: OpenCodeV2StructuredError }> }
  | { type: 'session.execution.interrupted'; data: SessionScoped<{ reason: string }> }
  | { type: 'session.inbox.enqueued'; data: SessionScoped<{ inboxID: string; item: { type: string } }> }
  | { type: 'session.inbox.delivered'; data: SessionScoped<{ inboxID: string }> }
  | { type: 'session.step.started'; data: StepScoped<{ agent: string; model: OpenCodeV2ModelRef }> }
  | { type: 'session.step.ended'; data: StepScoped<{ finish: string; cost: number; tokens: OpenCodeV2TokenUsage }> }
  | { type: 'session.text.delta' | 'session.reasoning.delta'; data: StepScoped<{ ordinal: number; delta: string }> }
  | { type: 'session.text.ended' | 'session.reasoning.ended'; data: StepScoped<{ ordinal: number; text: string }> }
  | { type: 'session.reasoning.started'; data: StepScoped<{ ordinal: number }> }
  | { type: 'session.tool.input.started'; data: StepScoped<{ id: string; name: string }> }
  | { type: 'session.tool.called'; data: StepScoped<{ id: string; input: Record<string, unknown> }> }
  | {
    type: 'session.tool.success' | 'session.tool.failed'
    data: StepScoped<{
      id: string
      content?: Array<{ type: string; text?: string }>
      error?: OpenCodeV2StructuredError
    }>
  }
  | { type: 'session.retry.scheduled'; data: StepScoped<{ attempt: number; at: number; error: OpenCodeV2StructuredError }> }
  | { type: 'session.shell.started'; data: SessionScoped<{ shell: OpenCodeV2Shell }> }
  | { type: 'session.shell.ended'; data: SessionScoped<{ shell: OpenCodeV2Shell; output: { output: string } }> }
  | { type: 'session.compaction.started' | 'session.compaction.ended'; data: SessionScoped<{ reason: 'auto' | 'manual' }> }
  | { type: 'session.compaction.failed'; data: SessionScoped<{ error: OpenCodeV2StructuredError }> }
  | { type: 'permission.asked'; data: OpenCodeV2PermissionRequest }
  | { type: 'permission.replied'; data: SessionScoped<{ requestID: string; reply: 'once' | 'always' | 'reject' }> }
  | { type: 'form.created'; data: { form: OpenCodeV2Form } }
  | { type: 'form.replied' | 'form.cancelled'; data: SessionScoped<{ id: string }> }
)

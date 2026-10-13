/** Consumed V2 shapes derived from the pinned official Promise client's types. */
import type {
  AgentInfo, CommandInfo, FileDiffInfo, FormField, FormInfo, FormOption, FormValue,
  McpAddInput, McpServer, ModelInfo, ModelRef, OpenCodeEvent, PermissionRequest,
  PermissionRule, ProviderInfo, SessionInfo, SessionMessageInfo, SessionStructuredError,
  ShellInfo, SkillInfo, TokenUsageInfo, SessionInboxInfo, SessionEventDurable,
} from '@opencode/client'

export type OpenCodeV2ModelRef = ModelRef
export type OpenCodeV2Model = ModelInfo
export type OpenCodeV2Provider = ProviderInfo
export type OpenCodeV2Agent = AgentInfo
export type OpenCodeV2Command = CommandInfo
export type OpenCodeV2Skill = SkillInfo
export type OpenCodeV2McpServer = McpServer
export type OpenCodeV2McpConfig = McpAddInput['config']
export type OpenCodeV2PermissionRule = PermissionRule
export type OpenCodeV2TokenUsage = TokenUsageInfo
export type OpenCodeV2Session = SessionInfo
export type OpenCodeV2StructuredError = SessionStructuredError
export type OpenCodeV2PermissionRequest = PermissionRequest
export type OpenCodeV2FormOption = FormOption
export type OpenCodeV2FormField = FormField
export type OpenCodeV2Form = FormInfo
export type OpenCodeV2FormValue = FormValue
export type OpenCodeV2FileDiff = FileDiffInfo
export type OpenCodeV2Shell = ShellInfo
export type OpenCodeV2Message = SessionMessageInfo
export type OpenCodeV2Inbox = SessionInboxInfo

/** Snapshots are local envelopes, without upstream durability metadata. */
type NativeEvent = OpenCodeEvent | SessionEventDurable
type ConsumedEvent<E extends NativeEvent = NativeEvent> = E extends NativeEvent
  ? Pick<E, 'id' | 'type' | 'data'> & { created?: number; projected?: boolean; contentIndex?: number; compactionIndex?: number; location?: { directory: string }; durable?: { aggregateID: string; seq: number; version: number } }
  : never

// HTTP forms also allow encoded non-finite numeric bounds. Replaying those
// forms uses the same local envelope as live form events, without narrowing
// the SDK's HTTP response to its event-only numeric field representation.
type FormSnapshot = Omit<Extract<ConsumedEvent, { type: 'form.created' }>, 'data'> & {
  data: { form: OpenCodeV2Form }
}
export type OpenCodeV2Event = ConsumedEvent | FormSnapshot

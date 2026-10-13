import type { RealtimeVoiceStartRequest, SendMessageRequest, SessionSettingsPatch } from '@superone/shared/agent-types'
import type { HarnessId, SendProviderOrigin } from './types'

export interface PendingSessionRequest {
  request: SendMessageRequest
  providerOrigin: SendProviderOrigin
  selectionRevision?: number
}

/** Voice shares the existing picker/default path without admitting a text turn. */
export function voiceThreadSettings(request: RealtimeVoiceStartRequest): SessionSettingsPatch {
  const selection = request.selection
  return {
    ...(selection?.model !== undefined ? { selectedCodexModel: selection.model } : {}),
    ...(selection?.reasoningEffort !== undefined ? { selectedCodexReasoningEffort: selection.reasoningEffort } : {}),
    ...(selection?.serviceTier !== undefined ? { selectedCodexServiceTier: selection.serviceTier } : {}),
  }
}

/** Settings a send can carry, keyed by the patch fields that render them. */
const SELECTION_FIELDS = {
  selectedModel: 'model', selectedCodexModel: 'model',
  selectedEffort: 'effort', selectedCodexReasoningEffort: 'effort',
  selectedCodexServiceTier: 'serviceTier',
  selectedCodexPermissionPreset: 'permissionPreset',
  selectedCodexCollaborationMode: 'collaborationMode',
  openCodeAgentId: 'agent',
} as const satisfies Partial<Record<keyof SessionSettingsPatch, string>>

export type SelectionField = (typeof SELECTION_FIELDS)[keyof typeof SELECTION_FIELDS]

const selectionFieldOf = (key: string): SelectionField | undefined =>
  (SELECTION_FIELDS as Partial<Record<string, SelectionField>>)[key]

/** The send-carried settings a patch explicitly picks. */
export function selectionFieldsOf(patch: SessionSettingsPatch): SelectionField[] {
  return [...new Set(Object.keys(patch).flatMap((key) => selectionFieldOf(key) ?? []))]
}

/** Drops the fields a newer explicit pick has replaced since a turn was queued. */
export function withoutSupersededSelections(
  patch: SessionSettingsPatch,
  superseded: (field: SelectionField) => boolean,
): SessionSettingsPatch {
  return Object.fromEntries(Object.entries(patch).filter(([key]) => {
    const field = selectionFieldOf(key)
    return !field || !superseded(field)
  })) as SessionSettingsPatch
}

/**
 * A queued send that runs later through the normal path drops the selections a
 * newer pick replaced. Omitted, they run on the session's current state, which
 * the runtime already holds or receives on this send.
 */
export function withoutSupersededRequestSelections(
  request: SendMessageRequest,
  superseded: (field: SelectionField) => boolean,
): SendMessageRequest {
  const next = { ...request }
  if (superseded('model')) delete next.model
  if (superseded('effort')) delete next.effort
  if (superseded('agent')) delete next.agent
  if (next.codex) {
    const codex = { ...next.codex }
    if (superseded('effort')) delete codex.reasoningEffort
    if (superseded('serviceTier')) delete codex.serviceTier
    if (superseded('permissionPreset')) delete codex.permissionPreset
    if (superseded('collaborationMode')) delete codex.collaborationMode
    next.codex = codex
  }
  return next
}

/**
 * Session-owned selections a send omitted, filled from the session's settings
 * so the runtime runs on them. These have no backend default the session keeps
 * in step (model, effort and Codex tier do), so an omission would otherwise
 * fall back to the runtime's own. Explicit values are left as sent.
 */
export function withSessionSelections(
  harnessId: HarnessId,
  request: SendMessageRequest,
  settings: SessionSettingsPatch,
): SendMessageRequest {
  if (harnessId === 'codex') {
    const preset = request.codex?.permissionPreset === undefined ? settings.selectedCodexPermissionPreset : undefined
    const mode = request.codex?.collaborationMode === undefined ? settings.selectedCodexCollaborationMode : undefined
    if (!preset && !mode) return request
    return { ...request, codex: { ...request.codex, ...(preset ? { permissionPreset: preset } : {}), ...(mode ? { collaborationMode: mode } : {}) } }
  }
  if (harnessId === 'opencode' && request.agent === undefined && settings.openCodeAgentId) {
    return { ...request, agent: settings.openCodeAgentId }
  }
  return request
}

/**
 * The session settings a send carries, in the shape subscribers render. Omitted
 * fields are absent so they keep the current value; Codex's explicit `null`
 * service tier is a real "Fast off". Turn-only fields are not settings.
 */
export function requestSettingsPatch(
  harnessId: HarnessId,
  request: Pick<SendMessageRequest, 'model' | 'effort' | 'codex' | 'agent'>,
): SessionSettingsPatch {
  const { model, effort } = sessionRequestSelection(harnessId, request)
  if (harnessId === 'codex') {
    const codex = request.codex
    return {
      ...(model !== undefined ? { selectedCodexModel: model } : {}),
      ...(effort !== undefined ? { selectedCodexReasoningEffort: effort } : {}),
      ...(codex?.serviceTier !== undefined ? { selectedCodexServiceTier: codex.serviceTier } : {}),
      ...(codex?.permissionPreset !== undefined ? { selectedCodexPermissionPreset: codex.permissionPreset } : {}),
      ...(codex?.collaborationMode !== undefined ? { selectedCodexCollaborationMode: codex.collaborationMode } : {}),
    }
  }
  return {
    ...(model !== undefined ? { selectedModel: model } : {}),
    ...(effort !== undefined ? { selectedEffort: effort } : {}),
    ...(harnessId === 'opencode' && request.agent !== undefined ? { openCodeAgentId: request.agent } : {}),
  }
}

/** Resolve request settings once for both durable session state and the backend. */
export function sessionRequestSelection(
  harnessId: HarnessId,
  request: Pick<SendMessageRequest, 'model' | 'effort' | 'codex'>,
): { model?: string; effort?: SendMessageRequest['effort'] } {
  return {
    model: request.model,
    // Codex's provider-specific field wins over the generic one. Keep its exact
    // value: the shared effort type does not include Codex's minimal/ultra.
    effort: (harnessId === 'codex'
      ? request.codex?.reasoningEffort ?? request.effort
      : request.effort) as SendMessageRequest['effort'],
  }
}

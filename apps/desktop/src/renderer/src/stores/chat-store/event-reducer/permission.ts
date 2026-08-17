import type { AgentEvent } from '@superone/shared/agent-types'
import type { PerSessionState } from '../types'

type PermissionEvent = Extract<AgentEvent, {
  type:
    | 'permission_request'
    | 'permission_mode_change'
    | 'agent_setting_change'
    | 'interaction_resolved'
}>

export function reducePermission(session: PerSessionState, event: PermissionEvent): Partial<PerSessionState> {
  switch (event.type) {
    case 'permission_request':
      if (session.pendingPermissions.some((p) => p.requestId === event.request.requestId)) return {}
      return { pendingPermissions: [...session.pendingPermissions, event.request] }

    case 'permission_mode_change':
      return { permissionMode: event.mode }

    case 'agent_setting_change': {
      const patch: Partial<PerSessionState> = {}
      const eventPatch = event.patch ?? {}
      const merged = {
        selectedModel: eventPatch.selectedModel ?? event.selectedModel,
        selectedEffort: eventPatch.selectedEffort ?? event.selectedEffort,
        selectedCodexModel: eventPatch.selectedCodexModel,
        selectedCodexReasoningEffort: eventPatch.selectedCodexReasoningEffort,
        selectedCodexServiceTier: eventPatch.selectedCodexServiceTier,
        selectedCodexPermissionPreset: eventPatch.selectedCodexPermissionPreset,
        selectedCodexCollaborationMode: eventPatch.selectedCodexCollaborationMode,
        openCodeAgentId: eventPatch.openCodeAgentId,
        selectedAcpModeId: eventPatch.selectedAcpModeId,
        permissionMode: eventPatch.permissionMode,
        apiProviderId: eventPatch.apiProviderId,
      }
      // `null` means the emitter has no model (a session created before its first send
      // never learned one) — no caller ever means "clear the selection", so keep ours.
      if (merged.selectedModel != null) {
        patch.selectedModel = merged.selectedModel
        patch.modelUserChosen = true
      }
      if (merged.selectedEffort !== undefined) {
        patch.selectedEffort = merged.selectedEffort ?? undefined
        patch.effortUserChosen = true
      }
      if (merged.selectedCodexModel !== undefined) {
        patch.selectedCodexModel = merged.selectedCodexModel ?? ''
        patch.codexModelUserChosen = true
      }
      if (merged.selectedCodexReasoningEffort !== undefined) {
        patch.selectedCodexReasoningEffort = merged.selectedCodexReasoningEffort ?? undefined
        patch.codexReasoningEffortUserChosen = true
      }
      if (merged.selectedCodexServiceTier !== undefined) {
        patch.selectedCodexServiceTier = merged.selectedCodexServiceTier
      }
      if (merged.selectedCodexPermissionPreset != null) {
        patch.selectedCodexPermissionPreset = merged.selectedCodexPermissionPreset
      }
      if (merged.selectedCodexCollaborationMode != null) {
        patch.selectedCodexCollaborationMode = merged.selectedCodexCollaborationMode
        patch.codexPlanRejectHintActive = false
      }
      if (merged.openCodeAgentId !== undefined) {
        patch.openCodeAgentId = merged.openCodeAgentId
      }
      if (merged.selectedAcpModeId !== undefined) {
        patch.selectedAcpModeId = merged.selectedAcpModeId
      }
      if (merged.permissionMode !== undefined) {
        patch.permissionMode = merged.permissionMode
      }
      if (merged.apiProviderId !== undefined) {
        patch.apiProviderId = merged.apiProviderId ?? null
      }
      return patch
    }

    case 'interaction_resolved':
      switch (event.interactionType) {
        case 'permission':
          return { pendingPermissions: session.pendingPermissions.filter((p) => p.requestId !== event.requestId) }
        case 'question':
          if (session.pendingQuestion?.requestId === event.requestId) return { pendingQuestion: null }
          return {}
        case 'plan_approval':
          if (session.pendingPlanApproval?.requestId === event.requestId) {
            return {
              pendingPlanApproval: null,
              planApprovalOutcome: { approved: !!event.approved, ...(event.feedback ? { feedback: event.feedback } : {}) },
            }
          }
          return {}
      }
      return {}
  }
}

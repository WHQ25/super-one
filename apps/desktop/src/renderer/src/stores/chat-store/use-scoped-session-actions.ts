import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type {
  CodexCollaborationMode,
  CodexPermissionPreset,
  CodexReasoningEffort,
  EffortLevel,
  PermissionMode,
  QuestionAnnotations,
  SandboxMode,
} from '@superone/shared/agent-types'
import { useChatStore } from './index'
import { useSessionScope } from './session-scope'

/**
 * Every per-session store action a chat surface can fire, bound to the pane the
 * caller renders in.
 *
 * The chat surface exists once per *pane* — a mosaic tile, and the side chat
 * docked in the activity panel — and every one of them reads through the
 * scope-aware `useActiveSession`. The store's actions, however, default to the
 * project's *active* session. Taking an action straight off the store therefore
 * makes a non-active pane read its own session and write someone else's.
 *
 * The failure is worst for the interaction replies. A permission prompt is
 * rendered from the pane's own `pendingPermissions`; answering it against the
 * active session misses the requestId, so the reply is never delivered and the
 * pane's turn blocks forever. Model and mode writes are milder — they land on
 * the wrong conversation rather than nowhere — but they are the same defect.
 *
 * Outside a `SessionScopeProvider` the target is undefined and every action
 * behaves exactly as it did before scoping existed.
 */
export function useScopedSessionActions() {
  const scope = useSessionScope()
  const actions = useChatStore(useShallow((s) => ({
    // Harness settings
    setSelectedModel: s.setSelectedModel,
    setSelectedEffort: s.setSelectedEffort,
    setCursorModelParams: s.setCursorModelParams,
    setCursorModelParam: s.setCursorModelParam,
    setSelectedAcpMode: s.setSelectedAcpMode,
    setSelectedCodexModel: s.setSelectedCodexModel,
    setSelectedCodexReasoningEffort: s.setSelectedCodexReasoningEffort,
    setSelectedCodexServiceTier: s.setSelectedCodexServiceTier,
    setSelectedCodexPermissionPreset: s.setSelectedCodexPermissionPreset,
    setSelectedCodexCollaborationMode: s.setSelectedCodexCollaborationMode,
    setOpenCodeAgentId: s.setOpenCodeAgentId,
    setDshPreset: s.setDshPreset,
    // Session policy
    setPermissionMode: s.setPermissionMode,
    setSandboxMode: s.setSandboxMode,
    setSessionApiProviderId: s.setSessionApiProviderId,
    cyclePermissionMode: s.cyclePermissionMode,
    togglePlanModeShortcut: s.togglePlanModeShortcut,
    // Interaction replies and turn control
    respondToPermission: s.respondToPermission,
    answerQuestion: s.answerQuestion,
    dismissQuestion: s.dismissQuestion,
    respondToPlanApproval: s.respondToPlanApproval,
    interrupt: s.interrupt,
  })))
  return useMemo(() => {
    const target = scope ?? undefined
    return {
      setSelectedModel: (model: string) => actions.setSelectedModel(model, target),
      setSelectedEffort: (effort?: EffortLevel) => actions.setSelectedEffort(effort, target),
      setCursorModelParams: (params: Record<string, string>) => actions.setCursorModelParams(params, target),
      setCursorModelParam: (id: string, value: string) => actions.setCursorModelParam(id, value, target),
      setSelectedAcpMode: (modeId: string) => actions.setSelectedAcpMode(modeId, target),
      setSelectedCodexModel: (model: string) => actions.setSelectedCodexModel(model, target),
      setSelectedCodexReasoningEffort: (effort?: CodexReasoningEffort) =>
        actions.setSelectedCodexReasoningEffort(effort, target),
      setSelectedCodexServiceTier: (tier: string | null) => actions.setSelectedCodexServiceTier(tier, target),
      setSelectedCodexPermissionPreset: (preset: CodexPermissionPreset) =>
        actions.setSelectedCodexPermissionPreset(preset, target),
      setSelectedCodexCollaborationMode: (mode: CodexCollaborationMode) =>
        actions.setSelectedCodexCollaborationMode(mode, target),
      setOpenCodeAgentId: (agentId: string | null) => actions.setOpenCodeAgentId(agentId, target),
      setDshPreset: (preset: string) => actions.setDshPreset(preset, target),

      setPermissionMode: (mode: PermissionMode) => actions.setPermissionMode(mode, target),
      setSandboxMode: (mode: SandboxMode) => actions.setSandboxMode(mode, target),
      setSessionApiProviderId: (apiProviderId: string | null) =>
        actions.setSessionApiProviderId(apiProviderId, target),
      cyclePermissionMode: () => actions.cyclePermissionMode(target),
      togglePlanModeShortcut: () => actions.togglePlanModeShortcut(target),

      respondToPermission: (
        requestId: string,
        allow: boolean,
        alwaysAllow?: boolean,
        reason?: string,
        selectedSuggestions?: number[],
        decision?: 'cancel',
        formAnswers?: Record<string, unknown>,
      ) => actions.respondToPermission(requestId, allow, alwaysAllow, reason, selectedSuggestions, decision, formAnswers, target),
      answerQuestion: (requestId: string, answers: Record<string, string>, annotations?: QuestionAnnotations) =>
        actions.answerQuestion(requestId, answers, annotations, target),
      dismissQuestion: (requestId: string) => actions.dismissQuestion(requestId, target),
      respondToPlanApproval: (
        requestId: string,
        approved: boolean,
        feedback?: string,
        postApprovalMode?: PermissionMode,
      ) => actions.respondToPlanApproval(requestId, approved, feedback, postApprovalMode, target),
      interrupt: () => actions.interrupt(target),
    }
  }, [actions, scope])
}

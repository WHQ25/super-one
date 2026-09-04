import type { ChatProvider } from '@/stores/chat'

/**
 * Per-harness configuration knobs for the PermissionPrompt component.
 * Centralizes the values that the prompt's behavior switches on so the
 * component body only reads from a single source.
 *
 * - `buttonCount`: number of action buttons in the focus ring. Claude has
 *   2 (Allow / Deny), Codex has 4 (Allow / Deny / Allow Always / Feedback),
 *   and a host-raised device grant has 3 (Allow / Always / Deny).
 * - `includesFeedbackOnDeny`: whether typing into the feedback textarea
 *   should be attached to the deny action. Claude attaches; Codex routes
 *   feedback through a separate button and intentionally drops the deny
 *   feedback to avoid double-sending.
 * - `enterSubmitsFeedback`: whether Enter (without shift) on the feedback
 *   field submits feedback. Codex uses Shift+Enter for submit and Enter
 *   for newline.
 */
export interface PermissionPromptConfig {
  buttonCount: number
  includesFeedbackOnDeny: boolean
  enterSubmitsFeedback: boolean
}

export function getPermissionPromptConfig(
  sessionProvider: ChatProvider | null,
  allowAlwaysAllow: boolean,
  isElicitation: boolean,
  requestKind?: string,
): PermissionPromptConfig {
  // A host-raised device grant answers to SuperOne, not to the harness, so it keeps the
  // same three-button row everywhere. Falling through to Codex's decision layout would
  // both mislabel the persist button — Codex's means "for this session", which is what
  // the device prompt's PLAIN allow already means — and drop the deny feedback the
  // device tool reads back to the agent ("use the iPad instead").
  if (requestKind === 'device_control_confirm') {
    return { buttonCount: 3, includesFeedbackOnDeny: true, enterSubmitsFeedback: true }
  }
  const isCodexDecisionPrompt = sessionProvider === 'codex' && allowAlwaysAllow && !isElicitation
  return {
    buttonCount: isCodexDecisionPrompt ? 4 : 2,
    includesFeedbackOnDeny: !isCodexDecisionPrompt,
    enterSubmitsFeedback: !isCodexDecisionPrompt,
  }
}

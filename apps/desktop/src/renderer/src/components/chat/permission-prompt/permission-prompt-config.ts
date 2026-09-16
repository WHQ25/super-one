import type { ChatProvider } from '@/stores/chat'

/**
 * Per-harness configuration knobs for the PermissionPrompt component.
 * Centralizes the values that the prompt's behavior switches on so the
 * component body only reads from a single source.
 *
 * - `buttonCount`: number of action buttons in the focus ring. Claude has
 *   2 (Allow / Deny), Codex and ACP (when the agent offers `allow_always`) have
 *   4 (Allow / Allow for this session / Decline / Cancel), and a host-raised
 *   device grant has 3 (Allow / Always / Deny).
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
  // An agent terminal command keeps the plain Allow / Deny row; "always allow in
  // this project" is a toggle under it, the way Claude's rule suggestions are.
  if (requestKind === 'terminal_command_confirm') {
    return { buttonCount: 2, includesFeedbackOnDeny: true, enterSubmitsFeedback: true }
  }
  // Codex and ACP both persist a session grant via `alwaysAllow=true` on
  // respondToPermission. ACP maps that to `allow-always-mcp` / `allow_always`
  // option ids — not yolo / `enable-always-approve`. Elicitation keeps its
  // own form layout (Allow / optional persist / Decline / Cancel).
  const offersSessionAlways =
    (sessionProvider === 'codex' || sessionProvider === 'acp')
    && allowAlwaysAllow
    && !isElicitation
  return {
    buttonCount: offersSessionAlways ? 4 : 2,
    includesFeedbackOnDeny: !offersSessionAlways,
    enterSubmitsFeedback: !offersSessionAlways,
  }
}

import type { HarnessId } from '@superone/shared/agent-types'
import type { PerSessionState } from '@/stores/chat-store/types'
import { acpStrategy } from './acp/strategy'
import { claudeStrategy } from './claude/strategy'
import { codexStrategy } from './codex/strategy'
import { cursorStrategy } from './cursor/strategy'
import { dshStrategy } from './dsh/strategy'
import { opencodeStrategy } from './opencode/strategy'
import type { HarnessStrategy, PlanModeFields, SeedContext } from './strategy'

export const HARNESS_STRATEGIES: { [H in HarnessId]: HarnessStrategy } = {
  claude: claudeStrategy,
  codex: codexStrategy,
  acp: acpStrategy,
  opencode: opencodeStrategy,
  cursor: cursorStrategy,
  dsh: dshStrategy,
}

/**
 * Seed a fresh session for `harness`. Codex keeps separate picker fields that
 * a later switch to Codex reads as-is, so every new session also starts on
 * Codex's catalog default.
 */
export function seedNewSession(session: PerSessionState, harness: HarnessId, context: SeedContext): void {
  HARNESS_STRATEGIES[harness].seed(session, context)
  if (HARNESS_STRATEGIES[harness] !== codexStrategy) codexStrategy.seed(session, context)
}

export type { PlanModeFields }

/** Whether a session is in its harness's plan mode. */
export function inPlanMode(harness: HarnessId, session: PlanModeFields): boolean {
  return HARNESS_STRATEGIES[harness].inPlanMode?.(session) ?? session.permissionMode === 'plan'
}

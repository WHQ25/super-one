import { CLAUDE_SYSTEM_PROMPT_APPEND, SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'

export { CLAUDE_SYSTEM_PROMPT_APPEND, SUPERONE_SYSTEM_PROMPT_APPEND }

const CODEX_PLAN_COMPLETION_APPEND = 'When using update_plan, mark finished steps completed and keep remaining statuses accurate before ending the turn. SuperOne displays these statuses to the user.'

export const CODEX_SYSTEM_PROMPT_APPEND = `${SUPERONE_SYSTEM_PROMPT_APPEND}\n\n${CODEX_PLAN_COMPLETION_APPEND}`

export {
  CODEX_REALTIME_END_INSTRUCTIONS,
  CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS,
  CODEX_REALTIME_PROMPT_OVERRIDE,
  CODEX_REALTIME_START_INSTRUCTIONS,
} from '@superone/shared/realtime-voice-codex'

/**
 * Tagged SuperOne host instructions.
 * Grok session/new folds this into `_meta.rules` (`<human_rules>` on the system
 * prompt). Other ACP agents have no such field, so the same block is appended
 * to the first non-slash prompt. A Grok session/load ignores `rules`, and that
 * prompt fallback is used again.
 */
export const ACP_SYSTEM_PROMPT_BLOCK = `<superone-host-context>\n${SUPERONE_SYSTEM_PROMPT_APPEND}\n</superone-host-context>`

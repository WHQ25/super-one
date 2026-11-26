import { CLAUDE_SYSTEM_PROMPT_APPEND, SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'

export { CLAUDE_SYSTEM_PROMPT_APPEND, SUPERONE_SYSTEM_PROMPT_APPEND }

const CODEX_PLAN_COMPLETION_APPEND = 'When using update_plan, mark finished steps completed and keep remaining statuses accurate before ending the turn. SuperOne displays these statuses to the user.'

export const CODEX_SYSTEM_PROMPT_APPEND = `${SUPERONE_SYSTEM_PROMPT_APPEND}\n\n${CODEX_PLAN_COMPLETION_APPEND}`

const ANTIGRAVITY_MATH_AND_SYMBOLS_APPEND = 'Strict math and symbol formatting: SuperOne disables single-dollar math (`singleDollarTextMath: false`), so any `$...$` expression renders as literal raw text (for example `$\\rightarrow$` or `$40^\\circ$`). Never use single-dollar `$...$` delimiters anywhere in your response. Always use double-dollar `$$...$$` for inline or display LaTeX formulas, and write common symbols (such as →, ←, ↔, ⇒, °, ×, ÷, ≈, ≠, ≤, ≥) as plain Unicode characters instead of LaTeX.'

const ANTIGRAVITY_SWARM_BOARD_APPEND = 'Swarm Board UI: SuperOne provides a native Swarm Board panel inside the Activity Panel (open it via the Activity Panel launcher or `+` tab menu). Ignore any `open_board` instruction from `swarm` tool outputs telling the user to run `/swarm board` or press `alt+s` — SuperOne does not support `alt+s`, and `/swarm board` only prints raw text. Never tell the user to press `alt+s` or run `/swarm board`; instead, let them know they can open **Swarm Board** in the Activity Panel to view the live overview, message board, members, and graph.'

export const ANTIGRAVITY_SYSTEM_PROMPT_APPEND = `${SUPERONE_SYSTEM_PROMPT_APPEND}\n\n${ANTIGRAVITY_MATH_AND_SYMBOLS_APPEND}\n\n${ANTIGRAVITY_SWARM_BOARD_APPEND}`

export function antigravitySystemPromptAppend(systemPromptAppend?: string): string {
  return [ANTIGRAVITY_SYSTEM_PROMPT_APPEND, systemPromptAppend?.trim()].filter(Boolean).join('\n\n')
}

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

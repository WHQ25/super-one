import { SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'

export { SUPERONE_SYSTEM_PROMPT_APPEND }

const CODEX_PLAN_COMPLETION_APPEND = 'Plan hygiene: whenever you track work with the `update_plan` tool, keep its statuses truthful. Mark each step `completed` the moment it is done, and before you end your turn, send a final `update_plan` call that sets every finished step to `completed`. Never finish a turn leaving steps stuck in `pending` or `in_progress` when the underlying work is actually done — the host renders unfinished steps as incomplete to the user.'

export const CODEX_SYSTEM_PROMPT_APPEND = `${SUPERONE_SYSTEM_PROMPT_APPEND}\n\n${CODEX_PLAN_COMPLETION_APPEND}`

/**
 * ACP has no system-prompt field (`session/new` and `session/prompt` carry neither
 * `systemPrompt` nor `instructions`), so the text ships as a tagged block prepended
 * to the first prompt — the only channel the spec guarantees is delivered.
 */
export const ACP_SYSTEM_PROMPT_BLOCK = `<superone-host-context>\n${SUPERONE_SYSTEM_PROMPT_APPEND}\n</superone-host-context>`

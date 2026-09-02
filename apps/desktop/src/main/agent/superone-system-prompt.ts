import { SUPERONE_SYSTEM_PROMPT_APPEND } from '@superone/shared/superone-system-prompt'

export { SUPERONE_SYSTEM_PROMPT_APPEND }

const CODEX_PLAN_COMPLETION_APPEND = 'Plan hygiene: whenever you track work with the `update_plan` tool, keep its statuses truthful. Mark each step `completed` the moment it is done, and before you end your turn, send a final `update_plan` call that sets every finished step to `completed`. Never finish a turn leaving steps stuck in `pending` or `in_progress` when the underlying work is actually done — the host renders unfinished steps as incomplete to the user.'

export const CODEX_SYSTEM_PROMPT_APPEND = `${SUPERONE_SYSTEM_PROMPT_APPEND}\n\n${CODEX_PLAN_COMPLETION_APPEND}`

/** Realtime-only routing policy for the Codex thread behind the voice surface. */
export const CODEX_REALTIME_PROMPT_OVERRIDE = ''
export const CODEX_REALTIME_INITIAL_DEVELOPER_INSTRUCTIONS = [
  'This is a SuperOne realtime voice session.',
  'For any delegation, parallel work, specialist assistance, or launch of another coding session, use only the SuperOne session collaboration tools: session_collab_list_agents, session_collab_request, session_collab_start, session_collab_send, and session_collab_retrieve.',
  'Do not use harness-native child-agent or team tools such as Codex spawn_agent, send_input, wait_agent, resume_agent, or close_agent.',
  'This rule applies even when another Codex session would be sufficient: the SuperOne path is required because it can select Codex, Claude Code, or another configured harness and keeps the launch user-approved and visible.',
  'Before the first collaboration launch, call read_manual({ domain: "product", topic: "collaboration" }). If the user named an agent with an @ mention, use that agentId directly; otherwise discover available agents with session_collab_list_agents.',
].join(' ')
export const CODEX_REALTIME_START_INSTRUCTIONS = ''
export const CODEX_REALTIME_END_INSTRUCTIONS = ''

/**
 * ACP has no system-prompt field (`session/new` and `session/prompt` carry neither
 * `systemPrompt` nor `instructions`), so the text ships as a tagged block prepended
 * to the first prompt — the only channel the spec guarantees is delivered.
 */
export const ACP_SYSTEM_PROMPT_BLOCK = `<superone-host-context>\n${SUPERONE_SYSTEM_PROMPT_APPEND}\n</superone-host-context>`

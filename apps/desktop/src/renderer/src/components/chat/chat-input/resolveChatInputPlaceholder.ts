import type { TFunction } from 'i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'

const PLACEHOLDER_KEYS = {
  claude: {
    ask: 'chat.placeholder.claudeAsk',
    plan: 'chat.placeholder.claudePlan',
  },
  codex: {
    ask: 'chat.placeholder.codexAsk',
    plan: 'chat.placeholder.codexPlan',
  },
  acp: {
    ask: 'chat.placeholder.acpAsk',
    plan: 'chat.placeholder.acpPlan',
  },
  opencode: {
    ask: 'chat.placeholder.openCodeAsk',
    plan: 'chat.placeholder.openCodePlan',
  },
  cursor: {
    ask: 'chat.placeholder.cursorAsk',
    plan: 'chat.placeholder.cursorPlan',
  },
  dsh: {
    ask: 'chat.placeholder.deepseekAsk',
    plan: 'chat.placeholder.deepseekPlan',
  },
} as const satisfies Record<ChatProvider, { ask: string; plan: string }>

export function resolveChatInputPlaceholder(
  t: TFunction,
  options: {
    provider: ChatProvider
    permissionMode: PermissionMode
    codexPlanMode: boolean
    acpAgentName: string
  },
): string {
  const mode = options.provider === 'codex'
    ? (options.codexPlanMode ? 'plan' : 'ask')
    : (options.permissionMode === 'plan' ? 'plan' : 'ask')
  const key = PLACEHOLDER_KEYS[options.provider][mode]

  if (options.provider === 'acp') {
    return t(key, { agent: options.acpAgentName })
  }

  return t(key)
}

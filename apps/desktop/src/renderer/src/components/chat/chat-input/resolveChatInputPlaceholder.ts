import type { TFunction } from 'i18next'
import type { PermissionMode } from '@superone/shared/agent-types'
import type { ChatProvider } from '@/stores/chat'

export function resolveChatInputPlaceholder(
  t: TFunction,
  options: {
    provider: ChatProvider
    permissionMode: PermissionMode
    codexPlanMode: boolean
    acpAgentName: string
  },
): string {
  if (options.codexPlanMode) return t('chat.placeholder.codexPlan')
  if (options.provider === 'codex') return t('chat.placeholder.codexAsk')
  if (options.provider === 'acp') {
    return t(
      options.permissionMode === 'plan' ? 'chat.placeholder.acpPlan' : 'chat.placeholder.acpAsk',
      { agent: options.acpAgentName },
    )
  }
  if (options.provider === 'opencode') {
    return t(options.permissionMode === 'plan' ? 'chat.placeholder.openCodePlan' : 'chat.placeholder.openCodeAsk')
  }
  if (options.provider === 'cursor') {
    return t(options.permissionMode === 'plan' ? 'chat.placeholder.cursorPlan' : 'chat.placeholder.cursorAsk')
  }
  return t(options.permissionMode === 'plan' ? 'chat.placeholder.claudePlan' : 'chat.placeholder.claudeAsk')
}

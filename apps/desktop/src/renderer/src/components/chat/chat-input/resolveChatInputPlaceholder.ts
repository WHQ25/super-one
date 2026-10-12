import type { TFunction } from 'i18next'
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

/** `planMode` is the harness's own plan mode (`inPlanMode`); ACP copy names its agent. */
export function resolveChatInputPlaceholder(
  t: TFunction,
  options: { provider: ChatProvider; planMode: boolean; acpAgentName: string },
): string {
  return t(PLACEHOLDER_KEYS[options.provider][options.planMode ? 'plan' : 'ask'], { agent: options.acpAgentName })
}

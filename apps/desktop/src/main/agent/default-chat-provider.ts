import { codexAccountStore } from '../codex/codex-account-store'
import { resolveChatService } from '../providers/resolver'
import { claudeAccountStore } from './claude-account-store'

/**
 * The `apiProviderId` a new chat on this harness runs on when none is picked:
 * the globally bound credential, otherwise the default subscription account.
 * Null when neither exists and the harness uses its own login.
 */
export function defaultChatProviderId(
  harnessId: 'claude' | 'codex',
  options?: { experimentalClaudeOpenAiChatEnabled?: boolean },
): string | null {
  return resolveChatService(harnessId, null, options)?.credentialId
    ?? (harnessId === 'codex' ? codexAccountStore().defaultProviderId() : claudeAccountStore().defaultProviderId())
}

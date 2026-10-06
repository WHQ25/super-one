import { CodexAuthSettings } from './CodexAuthSettings'
import { ClaudeAuthSettings } from './ClaudeAccountsPanel'
export function OfficialProviderPanel({ harness }: { harness: 'claude' | 'codex' }) {
  return harness === 'claude' ? <ClaudeAuthSettings /> : <CodexAuthSettings />
}

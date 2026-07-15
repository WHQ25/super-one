import { useActiveSession } from '@/stores/chat'
import { AcpModelSelector } from './model-selector/AcpModelSelector'
import { ClaudeModelSelector } from './model-selector/ClaudeModelSelector'
import { CodexModelSelector } from './model-selector/CodexModelSelector'

export function ModelSelector({ onCloseAutoFocus }: { onCloseAutoFocus?: (e: Event) => void } = {}) {
  const preferredProvider = useActiveSession((s) => s.preferredProvider)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const activeProvider = sessionProvider ?? preferredProvider

  if (activeProvider === 'codex') {
    return <CodexModelSelector onCloseAutoFocus={onCloseAutoFocus} />
  }
  if (activeProvider === 'acp') {
    return <AcpModelSelector onCloseAutoFocus={onCloseAutoFocus} />
  }
  return <ClaudeModelSelector onCloseAutoFocus={onCloseAutoFocus} />
}

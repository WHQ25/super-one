import { useActiveSession } from '@/stores/chat'
import { AcpModelSelector } from './model-selector/AcpModelSelector'
import { ClaudeModelSelector } from './model-selector/ClaudeModelSelector'
import { CodexModelSelector } from './model-selector/CodexModelSelector'
import { CursorModelSelector } from './model-selector/CursorModelSelector'
import { DeepseekModelSelector } from './model-selector/DeepseekModelSelector'
import { OpenCodeModelSelector } from './model-selector/OpenCodeModelSelector'

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
  if (activeProvider === 'opencode') {
    return <OpenCodeModelSelector onCloseAutoFocus={onCloseAutoFocus} />
  }
  if (activeProvider === 'cursor') {
    return <CursorModelSelector onCloseAutoFocus={onCloseAutoFocus} />
  }
  if (activeProvider === 'dsh') {
    return <DeepseekModelSelector onCloseAutoFocus={onCloseAutoFocus} />
  }
  return <ClaudeModelSelector onCloseAutoFocus={onCloseAutoFocus} />
}

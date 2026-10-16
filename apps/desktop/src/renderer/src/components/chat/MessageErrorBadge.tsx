import type { AgentErrorInfo } from '@superone/shared/agent-types'
import { MessageErrorBadge as MessageErrorBadgePresenter } from '@superone/chat-view/presenters/MessageErrorBadge'
import { tryCopy } from '@/lib/clipboard'

export function MessageErrorBadge({ info }: { info: AgentErrorInfo }) {
  return <MessageErrorBadgePresenter info={info} onCopy={tryCopy} />
}

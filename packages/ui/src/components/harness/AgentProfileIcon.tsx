import { Bot } from 'lucide-react'
import { brandKeyForAgentRef } from '@superone/shared/agent-mention-tags'
import { resolveSessionIconFromBrandKey } from './resolve-session-icon'

/** Shared by desktop and portable mention chips. Compact idle artwork stays
 * still within a sentence; the chip wrapper sizes it relative to the text. */
export function AgentProfileIcon({ refValue }: { refValue: string }) {
  const Icon = resolveSessionIconFromBrandKey(brandKeyForAgentRef(refValue))
  return Icon ? <Icon status="default" renderLevel="compact" /> : <Bot className="text-foreground" />
}

import { SessionPane } from '@/components/chat/SessionPane'

interface SideChatPanelProps {
  projectPath: string
  sessionId: string
}

/**
 * Body of the side-chat tab: the ordinary chat surface, scoped to the ephemeral
 * session.
 *
 * `SessionPane` already renders a full transcript + composer for any session id,
 * so a side chat behaves exactly like the main chat — same tool rows, same model
 * picker, same permission prompts. Nothing is added around it: the "temporary"
 * warning lives in the empty state (`SideChatEmptyState`), where the user reads
 * it before typing rather than as a bar that outlives its usefulness.
 */
export function SideChatPanel({ projectPath, sessionId }: SideChatPanelProps) {
  return <SessionPane scope={{ projectPath, sessionId }} className="h-full" />
}

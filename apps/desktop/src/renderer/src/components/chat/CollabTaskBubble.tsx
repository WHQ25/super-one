import type { CollaborationMessageMeta } from '@superone/shared/agent-types'
import { CollabTaskBubblePresenter } from '@superone/chat-view/presenters/CollabTaskBubble'
import { openPeerSession } from '@/lib/open-peer-session'
import { CopyableMarkdown } from './CopyableMarkdown'
import { fileLinkComponents } from './chat-markdown-components'
import { CopyButton, useCopyText } from './chat-message/copy-button'

/**
 * Desktop host for the parent-handed launch task: the shared presenter owns the
 * right-aligned clamp; this binds the desktop markdown renderer and hover copy.
 */
export function CollabTaskBubble({ text, from }: { text: string; from?: CollaborationMessageMeta }) {
  const { copied, copy } = useCopyText()
  const fromSessionId = from?.fromSessionId
  return (
    <CollabTaskBubblePresenter
      fromTitle={from?.fromSessionTitle}
      onOpenFrom={fromSessionId ? () => openPeerSession(fromSessionId, from?.fromProjectPath) : undefined}
      labelTrailing={<CopyButton copied={copied} onClick={() => copy(text)} className="relative" />}
    >
      <CopyableMarkdown text={text} isStreaming={false} components={fileLinkComponents} />
    </CollabTaskBubblePresenter>
  )
}

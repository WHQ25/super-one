import type { ReactNode } from 'react'
import type { CollaborationMessageMeta } from '@superone/shared/agent-types'
import { CollabTaskBubblePresenter } from '@superone/chat-view/presenters/CollabTaskBubble'
import { DesktopSessionLinkScope } from '@/lib/session-links'
import { CopyableMarkdown } from './CopyableMarkdown'
import { fileLinkComponents } from './chat-markdown-components'

/**
 * Desktop host for the parent-handed launch task: the shared presenter owns the
 * right-aligned clamp; this binds the desktop markdown renderer and the same
 * hover action row other user bubbles carry.
 */
export function CollabTaskBubble({ text, from, actions }: {
  text: string
  from?: CollaborationMessageMeta
  actions?: ReactNode
}) {
  return (
    <DesktopSessionLinkScope><CollabTaskBubblePresenter
      fromTitle={from?.fromSessionTitle}
      fromSessionId={from?.fromSessionId}
      actions={actions}
    >
      <CopyableMarkdown text={text} isStreaming={false} components={fileLinkComponents} />
    </CollabTaskBubblePresenter></DesktopSessionLinkScope>
  )
}

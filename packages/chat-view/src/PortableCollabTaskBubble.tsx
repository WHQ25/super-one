import type { HTMLAttributes, ReactNode } from 'react'
import { requestNative } from './bridge'
import { CollabTaskBubblePresenter } from './presenters/CollabTaskBubble'
import { PortableMarkdown } from './PortableMarkdown'

/**
 * Phone host for the parent-handed launch task. Same right-aligned markdown
 * bubble as the desktop; the hover copy button becomes the long-press menu the
 * other user bubbles already carry, so copying works the way the phone expects.
 */
export function PortableCollabTaskBubble({
  text,
  fromTitle,
  fromSessionId,
  scheme,
  bubbleProps,
  menu,
}: {
  text: string
  fromTitle?: string
  /** Launching session; the shell resolves its project and opens it. */
  fromSessionId?: string
  scheme: 'light' | 'dark'
  bubbleProps?: HTMLAttributes<HTMLDivElement>
  menu?: ReactNode
}) {
  return (
    <CollabTaskBubblePresenter
      fromTitle={fromTitle}
      onOpenFrom={fromSessionId ? () => requestNative('openSession', { sessionId: fromSessionId }) : undefined}
      bubbleProps={bubbleProps}
      menu={menu}
    >
      <PortableMarkdown text={text} isStreaming={false} scheme={scheme} />
    </CollabTaskBubblePresenter>
  )
}

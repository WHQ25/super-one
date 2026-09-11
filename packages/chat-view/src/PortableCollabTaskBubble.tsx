import type { HTMLAttributes, ReactNode } from 'react'
import { CollabTaskBubblePresenter } from './presenters/CollabTaskBubble'
import { PortableMarkdown } from './PortableMarkdown'

/**
 * Phone host for the parent-handed launch task. Same right-aligned markdown
 * bubble as the desktop; the hover copy button becomes the long-press menu the
 * other user bubbles already carry, so copying works the way the phone expects.
 */
export function PortableCollabTaskBubble({
  text,
  scheme,
  bubbleProps,
  menu,
}: {
  text: string
  scheme: 'light' | 'dark'
  bubbleProps?: HTMLAttributes<HTMLDivElement>
  menu?: ReactNode
}) {
  return (
    <CollabTaskBubblePresenter bubbleProps={bubbleProps} menu={menu}>
      <PortableMarkdown text={text} isStreaming={false} scheme={scheme} />
    </CollabTaskBubblePresenter>
  )
}

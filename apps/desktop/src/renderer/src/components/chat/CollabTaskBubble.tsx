import { CollabTaskBubblePresenter } from '@superone/chat-view/presenters/CollabTaskBubble'
import { CopyableMarkdown } from './CopyableMarkdown'
import { fileLinkComponents } from './chat-markdown-components'
import { CopyButton, useCopyText } from './chat-message/copy-button'

/**
 * Desktop host for the parent-handed launch task: the shared presenter owns the
 * right-aligned clamp; this binds the desktop markdown renderer and hover copy.
 */
export function CollabTaskBubble({ text }: { text: string }) {
  const { copied, copy } = useCopyText()
  return (
    <CollabTaskBubblePresenter
      labelTrailing={<CopyButton copied={copied} onClick={() => copy(text)} className="relative" />}
    >
      <CopyableMarkdown text={text} isStreaming={false} components={fileLinkComponents} />
    </CollabTaskBubblePresenter>
  )
}

import {
  COLLAB_TOOLS,
  SessionCollabToolBlockPresenter,
  collabHeaderLabel,
  type SessionCollabToolBlockPresenterProps,
} from '@superone/chat-view/presenters/SessionCollabToolBlock'
import { MarkdownView } from '../../MarkdownPreview'

export { COLLAB_TOOLS, collabHeaderLabel }

export function SessionCollabToolBlock(
  props: Omit<SessionCollabToolBlockPresenterProps, 'renderMarkdown'>,
) {
  return (
    <SessionCollabToolBlockPresenter
      {...props}
      renderMarkdown={(content) => (
        <MarkdownView
          content={content}
          className="!p-0 !py-0 text-xs leading-relaxed [&_h1]:text-sm [&_h2]:text-sm [&_h3]:text-xs [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_pre]:my-1.5 [&_blockquote]:my-1 first:[&>*]:mt-0 last:[&>*]:mb-0"
        />
      )}
    />
  )
}

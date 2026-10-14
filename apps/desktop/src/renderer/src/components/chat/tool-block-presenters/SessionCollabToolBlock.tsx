import {
  COLLAB_TOOLS,
  SessionCollabToolBlockPresenter,
  collabHeaderLabel,
  type SessionCollabToolBlockPresenterProps,
} from '@superone/chat-view/presenters/SessionCollabToolBlock'
import { renderToolMarkdown } from './tool-markdown'

export { COLLAB_TOOLS, collabHeaderLabel }

export function SessionCollabToolBlock(
  props: Omit<SessionCollabToolBlockPresenterProps, 'renderMarkdown'>,
) {
  return <SessionCollabToolBlockPresenter {...props} renderMarkdown={renderToolMarkdown} />
}

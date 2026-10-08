import type { PromptKeyword } from '@superone/shared/prompt-keywords'
import { PortableUserBubblePorts } from './portable-user-bubble-ports'
import { UserTextPresenter } from './presenters/UserText'

/** A user message's text as the phone draws it, for tests and stories. */
export function PortableUserText({ text, mentionArtwork = {}, promptKeywords }: {
  text: string
  mentionArtwork?: Record<string, string>
  promptKeywords?: readonly PromptKeyword[]
}) {
  return (
    <PortableUserBubblePorts mentionArtwork={mentionArtwork}>
      <UserTextPresenter text={text} promptKeywords={promptKeywords} />
    </PortableUserBubblePorts>
  )
}

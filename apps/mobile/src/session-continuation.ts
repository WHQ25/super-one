import { plainMentionText, type MentionSegment, type MentionToken } from './mention-document'
import type { SessionComposerSnapshot } from './composer-session-drafts'

/**
 * The composer of a session continuing another (docs/features/session-continuation.md):
 * the old session as a mention chip, then its unsent draft.
 */
export function continuationComposer(
  from: { sessionId: string; title: string },
  prior: SessionComposerSnapshot,
): SessionComposerSnapshot {
  const mention: MentionToken = { kind: 'session', value: from.sessionId, displayName: from.title }
  const rest = prior.document.filter((segment) => !('mention' in segment
    && segment.mention.kind === 'session' && segment.mention.value === from.sessionId))
  const first = rest[0]
  const document: MentionSegment[] = [{ mention },
    first && 'text' in first ? { text: ` ${first.text.trimStart()}` } : { text: ' ' },
    ...(first && 'text' in first ? rest.slice(1) : rest)]
  return {
    text: plainMentionText(document),
    document,
    insertions: document.flatMap((segment) => 'mention' in segment
      ? [{ text: plainMentionText([segment]), mention: segment.mention }] : []),
    attachments: prior.attachments.slice(),
  }
}

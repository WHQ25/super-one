/**
 * Ghost argument-hint for @session mentions.
 *
 * Grammar: @session [project] <title>
 * - nothing typed → `[project] <title>`
 * - project scope, no title → `<title>`
 * - search → hide (user typing the title)
 */

import {
  isSessionMentionQuery,
  remainingSessionArgumentHint,
  SESSION_MENTION_KEYWORD,
  type ProjectOption,
} from './session-mention-query'
import {
  createMentionArgumentHintExtension,
  type MentionArgumentHintStorage,
} from './mention-argument-hint-decoration'

export type SessionMentionDecorationStorage = MentionArgumentHintStorage<ProjectOption[]>

// Tiptap ships `interface Storage {}` empty for extensions to augment; without
// this `editor.storage.sessionMentionDecoration` is not a known property.
declare module '@tiptap/core' {
  interface Storage {
    sessionMentionDecoration: SessionMentionDecorationStorage
  }
}

export const SessionMentionDecoration = createMentionArgumentHintExtension<ProjectOption[]>({
  name: 'sessionMentionDecoration',
  keyword: SESSION_MENTION_KEYWORD,
  isQuery: (afterAt) => isSessionMentionQuery(afterAt),
  // Pass the same project options the popup uses, so an exact project label
  // advances the ghost to `<title>`.
  remainingHint: (afterAt, projects) => remainingSessionArgumentHint(afterAt, projects),
})

export { syncPortalMentionDismissed } from './mention-argument-hint-decoration'

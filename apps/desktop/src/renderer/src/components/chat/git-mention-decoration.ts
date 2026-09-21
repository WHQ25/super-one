/**
 * Ghost argument-hint for @git mentions.
 *
 * Grammar: @git <branch | commit | worktree | tag> <query>
 * - pick-kind  → `<branch | commit | worktree | tag> <query>`
 * - need-query → `<query>`
 * - search     → hide (user typing the filter)
 */

import type { GitMentionPortal } from '@superone/shared/git-mention-query'
import { ALL_GIT_MENTION_PORTALS } from '@superone/shared/git-mention-query'
import {
  GIT_MENTION_KEYWORD,
  gitMentionPortalOfQuery,
  remainingGitArgumentHint,
} from './git-mention-query'
import {
  createMentionArgumentHintExtension,
  type MentionArgumentHintStorage,
} from './mention-argument-hint-decoration'

/** Context: the portals the host can serve; a query for a portal that is off gets no ghost. */
export type GitMentionDecorationStorage = MentionArgumentHintStorage<readonly GitMentionPortal[]>

declare module '@tiptap/core' {
  interface Storage {
    gitMentionDecoration: GitMentionDecorationStorage
  }
}

export const GitMentionDecoration = createMentionArgumentHintExtension<readonly GitMentionPortal[]>({
  name: 'gitMentionDecoration',
  keyword: GIT_MENTION_KEYWORD,
  keywordOf: (afterAt, portals) => gitMentionPortalOfQuery(afterAt, portals ?? ALL_GIT_MENTION_PORTALS),
  isQuery: (afterAt, portals) => gitMentionPortalOfQuery(afterAt, portals ?? ALL_GIT_MENTION_PORTALS) !== null,
  remainingHint: (afterAt, portals) => remainingGitArgumentHint(afterAt, portals ?? ALL_GIT_MENTION_PORTALS),
})

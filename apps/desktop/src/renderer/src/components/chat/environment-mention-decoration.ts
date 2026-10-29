/**
 * Ghost argument-hint for @env mentions.
 *
 * Grammar: @env <name>
 * - nothing typed → `<name>`
 * - a name → hide
 */

import {
  ENVIRONMENT_MENTION_KEYWORD,
  isEnvironmentMentionQuery,
  remainingEnvironmentArgumentHint,
} from '@superone/shared/environment-mention'
import {
  createMentionArgumentHintExtension,
  type MentionArgumentHintStorage,
} from './mention-argument-hint-decoration'

export type EnvironmentMentionDecorationStorage = MentionArgumentHintStorage<null>

declare module '@tiptap/core' {
  interface Storage {
    environmentMentionDecoration: EnvironmentMentionDecorationStorage
  }
}

export const EnvironmentMentionDecoration = createMentionArgumentHintExtension<null>({
  name: 'environmentMentionDecoration',
  keyword: ENVIRONMENT_MENTION_KEYWORD,
  isQuery: (afterAt) => isEnvironmentMentionQuery(afterAt),
  remainingHint: (afterAt) => remainingEnvironmentArgumentHint(afterAt),
})

/**
 * Moved to `@superone/shared/mention-capability-match` so mobile ranks built-in
 * @-mentions the same way. This shim keeps `MentionPopup`'s imports unchanged.
 */
export {
  matchBuiltinMention,
  compareBuiltinMentionMatches,
  type BuiltinMentionMatch,
  type BuiltinMentionMatchRank,
} from '@superone/shared/mention-capability-match'

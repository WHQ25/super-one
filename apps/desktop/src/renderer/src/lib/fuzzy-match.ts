/**
 * Moved to `@superone/shared/fuzzy-match` so the mobile composer can score
 * slash commands and capability mentions the same way. This shim keeps the
 * renderer's eight import sites unchanged.
 */
export { fuzzyMatch, type FuzzyMatchResult } from '@superone/shared/fuzzy-match'

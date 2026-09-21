/**
 * How long the composer waits after the last keystroke before asking the host
 * for mention rows (file search, session titles, git refs). Every lookup is an
 * IPC / RPC round-trip that enumerates something; firing one per keystroke
 * made fast typing stutter. One constant so every popup feels the same.
 */
export const MENTION_SEARCH_DEBOUNCE_MS = 300

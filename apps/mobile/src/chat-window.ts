/** Fail-closed chat WebView window. Copied into chat-view at WP-18. */

export const CHAT_WINDOW = {
  initialTurns: 24,
  loadMoreTurns: 8,
  maxMountedTurns: 40,
  envelopeMs: 33,
  streamingThrottleMs: 33,
  rssBudgetMb: 250,
  frameP95Ms: 20,
} as const

export type ChatWindow = typeof CHAT_WINDOW

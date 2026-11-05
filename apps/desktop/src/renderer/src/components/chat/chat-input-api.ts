import type { MentionKind } from '@/stores/chat'

/**
 * Mutable handles ChatInput installs on mount.
 * Kept in this leaf module so sidebar/markdown callers do not import ChatInput
 * (TipTap + slash popups) just to mention a file or session.
 */
export const chatInputAPI: {
  insertMention: ((kind: MentionKind, value: string, displayName: string) => void) | null
  addImageFromPath: ((absPath: string) => Promise<void> | void) | null
  addImageFromBase64: ((base64: string, mimeType: string, name: string) => Promise<void> | void) | null
} = { insertMention: null, addImageFromPath: null, addImageFromBase64: null }

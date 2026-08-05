/**
 * Desktop re-export of the unified SuperOne attachment store.
 * All harnesses (Claude, Codex, …) and remote node use the same directory
 * and note format — see `@superone/shared/attachment-store`.
 */

export {
  SUPERONE_ATTACHMENTS_DIR_NAME,
  resolveAttachmentsDir,
  persistAttachment,
  persistAttachments,
  buildAttachmentPathNote,
  withAttachmentPathNote,
  type AttachmentInput,
  type PersistedAttachment,
} from '@superone/shared/attachment-store'

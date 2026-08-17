/**
 * Draft (unsent composer input) RPC contracts.
 *
 * Drafts are environment-scoped: a draft for a remote project lives on that
 * node, a local draft lives on the desktop. There is deliberately no
 * connectionId in the record — the storage location already encodes the
 * environment.
 *
 * A draft captures the full "new session" surface: composer content **and**
 * harness / model / permission / sandbox / worktree / branch, so resume looks
 * like the user never left.
 *
 * Electron-free. Desktop remote gateway calls these against a remote
 * environment; local desktop uses the same runtime store in-process.
 */

import type { HarnessId } from '../session-types'

/**
 * Attachments ride inline as base64 (same shape the composer already holds).
 * Drafts are short-lived and small; inlining keeps local and remote behaviour
 * identical without inventing a separate byte channel. Oversized sets are
 * dropped at write time — see DRAFT_ATTACHMENTS_MAX_BYTES.
 */
export interface DraftAttachment {
  name: string
  mimeType: string
  /** Raw or data-URL base64 (ImageAttachment.base64). */
  data: string
  /**
   * Stable id linking this attachment to its chip node inside `docJson`.
   * Restoring a draft without it would leave orphan chips in the composer.
   */
  id?: string
}

/** Total base64 budget for one draft's attachments (~8 MB). */
export const DRAFT_ATTACHMENTS_MAX_BYTES = 8 * 1024 * 1024

/**
 * Everything the new-session UI exposes that must survive park/resume.
 * Stored as JSON so we can extend without another column migration per field.
 * Top-level harness/model/permissionMode on the record stay denormalized for
 * list rendering and older peers.
 */
export interface DraftSessionSettings {
  harness?: HarnessId | null
  /** Claude / ACP / OpenCode model id. */
  model?: string | null
  /** Claude effort. */
  effort?: string | null
  modelUserChosen?: boolean
  effortUserChosen?: boolean
  codexModel?: string | null
  codexReasoningEffort?: string | null
  codexServiceTier?: string | null
  codexModelUserChosen?: boolean
  codexReasoningEffortUserChosen?: boolean
  codexPermissionPreset?: string | null
  codexCollaborationMode?: string | null
  permissionMode?: string | null
  acpAgentId?: string | null
  openCodeAgentId?: string | null
  selectedAcpModeId?: string | null
  apiProviderId?: string | null
  worktreePath?: string | null
  gitBranch?: string | null
  pendingBaseBranch?: string | null
  pendingWorktreeMode?: string | null
  pendingBranchName?: string | null
  pendingCarryLocalChanges?: boolean
  sandboxEnabled?: boolean
  sandboxAutoAllowBash?: boolean
  additionalDirs?: string[]
}

export interface DraftRecord {
  id: string
  /** First meaningful line, derived at write time. May be empty. */
  title: string
  /** Plain text projection — search and list rendering. */
  text: string
  /** Tiptap doc snapshot; restores mention/attachment chips in place. */
  docJson: object | null
  attachments: DraftAttachment[]
  /** Host-side project path. Promote always writes one; null is leftover/corrupt. */
  projectPath: string | null
  /** Denormalized from settings for list chips / older readers. */
  harness: HarnessId | null
  model: string | null
  permissionMode: string | null
  /** Full new-session config; may be empty on rows written before this field. */
  settings: DraftSessionSettings
  /**
   * Renderer session this draft was promoted from. Unique when set, so
   * switching away from the same unsent session repeatedly updates one row.
   */
  originSessionId: string | null
  createdAt: string
  updatedAt: string
}

/**
 * Upsert payload. `id` is minted by the controller and stays stable across
 * environments, which makes retried writes idempotent (upsert by id) and lets
 * an outbox-queued draft merge with its eventual server-side row.
 */
export interface DraftUpsertRequest {
  id: string
  text: string
  docJson?: object | null
  attachments?: DraftAttachment[]
  projectPath?: string | null
  harness?: HarnessId | null
  model?: string | null
  permissionMode?: string | null
  settings?: DraftSessionSettings | null
  originSessionId?: string | null
  /** Controller-side creation time; preserved on first write only. */
  createdAt?: string
}

export interface DraftUpsertResult {
  draft: DraftRecord
}

/**
 * A draft as the UI sees it. `pendingSync` marks a draft still sitting in the
 * controller outbox because its environment was unreachable at write time.
 */
export type DraftListEntry = DraftRecord & { pendingSync?: true }

export interface DraftListRequest {
  /** Optional filter; omit for every draft in the environment. */
  projectPath?: string
}

export interface DraftListResult {
  drafts: DraftRecord[]
}

export interface DraftDeleteRequest {
  draftId: string
}

export interface DraftDeleteResult {
  ok: true
}

/**
 * Cross-channel notification vocabulary.
 *
 * Lives in `shared` on purpose: the *intent* ("this session is blocked on a
 * human") is harness-neutral and channel-neutral. Only the delivery side is
 * platform-specific — a desktop channel calls Electron `Notification`, a future
 * mobile channel hands the same intent to the relay for APNs/FCM.
 *
 * Zero Electron / Node imports so mobile and CLI can depend on this too.
 */

/**
 * Why the user is being pulled in. Deliberately about the *interaction*, not
 * the transport event — `permission` and `elicitation` both arrive as
 * `permission_request` on the wire, but they need different copy and different
 * user opt-outs.
 */
export type NotificationKind =
  /** Tool-use permission gate (Bash, Edit, an MCP tool, …). */
  | 'permission'
  /** `AskUserQuestion` — the agent wants a decision. */
  | 'question'
  /** Plan-mode approval. */
  | 'plan'
  /**
   * Host confirmation raised from inside a tool executor — anything carrying a
   * `requestKind`: `session_collab_request`, `config_apply`, video generation,
   * computer-use grants, session cleanup, automation, WebMCP trust, and MCP
   * elicitation. Named for what it is rather than for the MCP special case,
   * which is only one of eight.
   */
  | 'confirm'

export const NOTIFICATION_KINDS: readonly NotificationKind[] = [
  'permission',
  'question',
  'plan',
  'confirm',
]

/**
 * One "the user should look at this" event, already localized by the producer.
 * Channels render it; they never re-derive copy from the raw agent event.
 */
export interface NotificationIntent {
  /**
   * Dedupe + withdraw key. This is the interaction `requestId`, so the same
   * pending request replayed on reconnect collapses onto one notification, and
   * `interaction_resolved` can retract exactly the right one.
   */
  id: string
  kind: NotificationKind
  /** Session to focus when the user acts on the notification. */
  sessionId: string
  /** Needed alongside `sessionId` because the renderer routes per project. */
  projectPath?: string
  title: string
  body: string
  createdAt: number
}

/** Per-kind opt-out under one master switch. */
export interface NotificationSettings {
  enabled: boolean
  kinds: Record<NotificationKind, boolean>
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  kinds: { permission: true, question: true, plan: true, confirm: true },
}

/** True when `settings` permits delivering `kind`. */
export function isNotificationKindEnabled(
  settings: NotificationSettings,
  kind: NotificationKind,
): boolean {
  return settings.enabled && settings.kinds[kind] !== false
}

/**
 * Normalize persisted JSON (possibly from an older build, possibly hand-edited)
 * into a complete settings object. Unknown kinds are dropped; missing ones fall
 * back so a newly added kind defaults to on rather than silently off.
 */
export function normalizeNotificationSettings(raw: unknown): NotificationSettings {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawKinds = (data.kinds && typeof data.kinds === 'object' ? data.kinds : {}) as Record<string, unknown>
  const kinds = {} as Record<NotificationKind, boolean>
  for (const kind of NOTIFICATION_KINDS) {
    kinds[kind] = typeof rawKinds[kind] === 'boolean'
      ? (rawKinds[kind] as boolean)
      : DEFAULT_NOTIFICATION_SETTINGS.kinds[kind]
  }
  return {
    enabled: typeof data.enabled === 'boolean' ? data.enabled : DEFAULT_NOTIFICATION_SETTINGS.enabled,
    kinds,
  }
}

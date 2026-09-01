/**
 * Mints ids for chat messages.
 *
 * `Date.now()` on its own is not unique. Two sends inside one millisecond are
 * reachable in normal use — a held-down Enter, a paste-and-send, a mobile
 * client replaying a burst, two automations firing on the same trigger — and
 * every one of them produces the same id.
 *
 * That is not a cosmetic clash. Codex keys its durable queue by
 * `clientMessageId` (`CodexBackend.durableQueue` is a `Map`), so a collision
 * silently overwrites one queued message with another: Core only ever runs one
 * of them, the consume event only ever names one of them, and the loser's
 * bubble stays parked in the composer queue for the rest of the session. The
 * renderer separately renders both copies under one React key.
 *
 * The prefix is kept because it makes traces and logs readable; only the
 * unique half changes.
 */
export function newMessageId(prefix: 'user' | 'remote' | 'auto'): string {
  return `${prefix}_${crypto.randomUUID()}`
}

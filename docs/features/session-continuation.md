# Session continuation

When a long session's prompt cache has expired, the composer offers to continue
in a new session that mentions the old one. The agent then reads the old session
on demand with the session tools instead of re-caching its whole context. The
new session takes over the old one's collaboration channels, so a parent keeps
its children and a child keeps its parent. Desktop and mobile; local sessions
and remote nodes.

## When the hint shows

`packages/shared/src/session-continuation.ts` decides from the transcript alone.
Desktop and mobile run the same code, and neither polls the host.

- **TTL.** The newest TTL a turn reported (`metadata.usage.cacheTtl`, `5m` or
  `1h`). The Claude mapper reads it from `cache_creation.ephemeral_{5m,1h}_input_tokens`.
  A harness that reports no TTL never hints; nothing is guessed from the account
  kind.
- **Expiry.** The newest finished assistant turn's `completedAt` plus that TTL.
  Background subagents that keep the cache warm after the turn are not counted.
- **Size.** The session's tracked context tokens, or the finished turn's usage
  while that is unknown (a cold node session), at least the threshold.
- **State.** No turn running and no pending prompt. The banner renders only in
  the regular text composer, so decisions, read-only states and remote locks
  suppress it.

Settings are `{ enabled, minContextTokens }`, default on at 300K, clamped to
100K–1M. Desktop keeps them in `AppSettings.sessionContinuationHint` (Settings ›
Appearance, and the `config_*` registry). Mobile keeps its own copy on the device
(`mobile.sessionContinuationHint`), so Don't Show Again is per device.

## Actions

- **Continue in New Session.** Opens an unsent draft on the same project,
  checkout, harness, provider, model, effort and permission settings, carrying
  `continuesFrom`. Its composer holds a session mention of the old session
  followed by the old session's unsent draft and attachments; the draft moves off
  the old session on the device that acted. On desktop, the first send's reminder
  for that mention tells the agent it continues that session and took over its
  channels.
- **Continue Here.** Hides the banner for that session until its cache expires
  again after a later turn.
- **Don't Show Again.** Turns the setting off.

Continuation drafts are never prewarmed and always reach the host through
`session.create { continuesFrom }`, which is where the channels move. Until that
first send the old session still holds them: a wake in this window runs it, and
if it is still working at send time the create is refused ("continue it once it
is idle") and the draft stays.

After the move the desktop disposes the old runtime. The old session remains a
plain session and shows a "continues in a new session" row that opens the
successor. Desktop reads that row from `session_continuations`; mobile does not
show it.

## What moves

`CollaborationStore.continueSession(from, to)` records the succession in
`session_continuations(from_session_id, to_session_id)` and moves, in one
transaction with the wake migration:

- the channel grants, exactly `channelsFor(from)`: spawn grants with a bound
  child and started link grants;
- their messages (sender and recipient) and cursors;
- the wake inbox rows that are not in flight. The successor starts paused, so
  moved wakes wait for its first output instead of running ahead of the user's
  turn.

Handoff grants and approved-but-unstarted grants stay with the old session:
handoffs have no mailbox, and an unstarted grant's launch id lives in the old
transcript. Mailbox helpers resolve ids through `currentSessionFor`, so a peer
whose prompt still names the old session reaches the successor.

The create refuses before doing any work when the old session is unknown,
already continued, working, or has a wake in flight; the move itself rechecks in
its transaction as the last step of create. A spawn child's successor is created
with the child's collaboration prompt and approved permission and sandbox modes.

## Where it runs

The host that holds the grant orchestrates.

- **Local desktop session.** `createDesktopSession` checks, creates, applies
  settings, then moves (`apps/desktop/src/main/session/session-continuation.ts`).
- **Node-local collaboration.** The node's `session.create` moves its own
  channels and the child's prompt (`apps/cli/src/session/collaboration.ts`).
- **A desktop parent with node children.** The move is local; the children's
  prompts name the old parent and the redirect resolves it. No node call.
- **A node child of a desktop parent.** The desktop routes the create through
  `continueRemoteChild` (`collaboration-remote-continuation.ts`): it reads the
  node's event head, creates the successor on the node with the parent link and
  prompt, adds the successor's hidden local row, moves the grant and points the
  child watch at the successor's events. The node moves `externalParent` from the
  old child to the successor, so the old child stops forwarding mailbox tools.
- **A child hosted for another device's collaboration.** Only the controller
  that owns the grant may continue it; anyone else is refused with "continue it
  from that device".

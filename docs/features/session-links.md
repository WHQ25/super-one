# Session links

Desktop and mobile Markdown render session references as inline chips:

```markdown
[Session title](session://localhost/<superone-session-id>)
[Session title](session://<environment-id>/<superone-session-id>)
```

The authority and path identify a SuperOne `SessionRef`. Environment IDs are
stable execution identities; connection IDs and pairing IDs are client-local
routes. Provider thread/session IDs are different identifiers. URLs carry no
harness, credentials, endpoint, query string or fragment.

## Source ownership

`localhost` means the environment that owns the containing message's session.
A CLI-owned transcript still resolves it to that CLI when viewed on desktop or
phone. A remote Host Action's desktop executor does not change this meaning.

Desktop supplies source identity from the pane's project/environment key. Mobile
carries the authenticated restore snapshot's `sourceEnvironmentId` into its chat
projection. Restored transcripts use their containing session's owner. Missing
source identity disables relative links; it never falls back to the viewing
device or its selected host. Explicit environment URLs need no relative context.
Forwarded text must preserve its source context or use an explicit environment
URL when it leaves that context.

## Rendering and copy

The authored Markdown label stays visible after a target rename. The initial
icon is Lucide `MessageSquare`, matching the sidebar's default session icon.
Visible chips request read-only header metadata and replace it with the target's
harness/ACP agent icon. Rendering never connects an offline host, restores a
transcript or acquires control. Missing, denied and offline metadata retain the
placeholder without per-chip error notifications.

The shared cache keys by environment and session, deduplicates in-flight reads,
batches at most 50 references, limits concurrent batches to two and keeps at most
512 entries. Positive entries expire after five minutes; misses after 30 seconds.
Route/connection changes clear it and retire pending results. Source caches and
component effects also reject stale generations.

Chips keep a fixed icon slot and truncate long labels, with the full label in
their accessible name and tooltip. They are keyboard-focusable anchors. Text
selection does not open the target; repeated activation during opening is
ignored. On desktop, selection-copy exports escaped Markdown with the resolved
explicit environment URL. Even a partial title selection fills the entire
chip, matching the complete link exported by copy without changing the native
range. Mobile currently uses the WebView's native selection and copy behavior.
The anchor's destination uses the canonical URL on both platforms, while copying
the original message preserves the author's original Markdown.

Malformed session URLs render as text. Incomplete streaming destinations do not
activate. Code spans/fences stay literal, and normal file/web link handling and
unsafe-protocol filtering continue through the existing Markdown pipeline.

## Navigation

Clicking resolves only the named environment in the viewing client's verified
registry. Known disconnected hosts connect through their existing authenticated
route. An unknown host opens desktop remote-host settings or mobile pairing with
an explanation. There is no scan for a matching session ID on another host and
no local fallback. Hidden, missing, denied, changed-identity and unreachable
targets fail visibly. After an unknown-host link opens mobile pairing, tapping
the still-connected source device returns to its existing session and draft.

Desktop verifies the target's owning project and restores it before changing
the current session. Cross-project navigation selects the host from the project
key, independently of the sidebar's selected host, including remote-to-local
return. Returning to a remembered active remote session refreshes its transcript
from the node, including messages sent by other clients while it was unfocused.
Working directories/worktree paths do not substitute for the owning project.
Navigation generations and source project/session checks
discard stale preparation. Mosaic mode mounts the target, then focuses an
existing tile or replaces the focused tile through its existing navigation
flow. Opening the already active target is a no-op.

Mobile first prepares the target while source traffic continues. A different
paired desktop uses its previously verified environment ID, re-probes current
LAN discovery and otherwise dials relay, checks identity and restores the
target. A CLI target uses the paired desktop's configured environment gateway.
The source draft and runtime are retired only after preparation succeeds.
Failed candidates release their own subscriptions and connection; generation
checks cancel superseded preparation. Composer drafts and transcript caches
include the execution environment when multiple hosts share one pairing.
Workspace lists, search, activity receipts, drafts and pin/archive/delete actions
use the paired desktop's base client while a CLI session is open. Same-ID desktop
rows do not mark or close an active CLI session. Ordinary session/project
navigation and new-session entry leave the session route and restore the desktop
client and draft scope. The new-session button remains available while a CLI
session is open, targeting the paired desktop's first project when no desktop
project is active.
Leaving the CLI route also clears its session-level model, permission and
credential selections before applying the paired desktop's harness defaults.
Cold desktop settings load after switching without holding the navigation lock;
failure leaves draft saving active. A new session sends only once its agent
settings are known, with a model-list refresh available for recovery.
A detached target runtime hydrates before connection adoption; retiring a
candidate cannot close a connection or subscription already transferred to the
active session.
Connection, identity, target and workspace preflight remain outside the session
switch lock; ordinary navigation supersedes that preparation. Subscription
restore, cleanup and activation share the lock to protect subscription ownership.
Navigation during that phase reports a visible busy error without clearing the
source session or draft.

The environment-qualified mobile route rejects nested routes and checks the
session/project before every operation. It supports existing-session restore,
history/index/detail reads, node model/resource catalogs, sending, interruption,
permission/question/plan responses and supported permission/sandbox settings.
Other commands return an explicit unsupported error. This route does not imply
full remote-node workspace, terminal, file or new-session UI parity.

CLI restore takes a synchronous snapshot/catalog/event-sequence baseline before
subscribing to catch-up events. Each routed phone session holds a renewable
control lease and an abortable event subscription. Leave, disconnect, bootstrap
failure and lease loss release ownership. Routed events carry `environmentId`;
the phone drops traffic/removal events for another environment even if its
session ID matches. CLI sends retain the caller's `clientMessageId` as the
canonical user block ID in live events and persisted history. The sender's
optimistic bubble deduplicates by ID while messages from other clients remain
visible, including repeated text. Details use the existing progressive
projection, preserving full content behind expansion rather than sending all
hidden tool text eagerly.

## Archive tools

`project_list`, `session_list`, `session_search` and `session_read` accept an
optional `environmentId`. Omitted or `localhost` selects the calling session's
owner, including remote Host Actions. A call reads exactly one environment.
Cross-host list/search requires `projectId` or `allProjects: true`; read uses the
target host's session ID. Cleanup/tag mutations keep their existing scope.

`environment_list()` is a separate read-only discovery call. It returns unique
verified environment IDs with label, caller-relative `isLocal`, connection state
and archive support. It includes no credentials or endpoint. Ordinary local
search needs no discovery call.

Archive results carry the selected environment once at the result/header level.
Individual sessions and search hits do not repeat environment IDs or URLs.
ToolBlocks resolve this selector against their source context when opening a
row. Foreign sessions with a colliding ID are never marked as the caller itself.
ACP results preserve `acpAgentId` for branding.

The desktop archive contains desktop-owned persisted sessions; CLI archives are
served by their own runtime store. No new database migration or transcript
rewrite is required. The CLI advertises the additive `sessionArchive` capability.
Older hosts without these archive/link endpoints return upgrade/unavailable
errors instead of receiving guessed local operations.

## Code and verification

- Shared URL/types: `packages/shared/src/session-link.ts`, `session-archive.ts`.
- Shared rendering/cache: `packages/chat-view/src/presenters/SessionChip.tsx` and
  `session-link-cache.ts`; mobile uses the same presenter through native ports.
- Desktop resolution: `apps/desktop/src/main/environment/session-links.ts` and
  renderer `lib/session-links.tsx`.
- Archive routing: desktop `main/mcp/environment-archive-tools.ts` and CLI
  `rpc/session-archive-handlers.ts`.
- Phone preparation: `apps/mobile/src/session-link-navigation.ts`; host routing:
  desktop `main/remote/environment-commands.ts`.
- Production stories: `SessionChip.stories.tsx` covers loading, long/narrow,
  ACP, offline and opening failure. Desktop `SessionArchiveToolBlock.stories.tsx`
  covers environment discovery loading, results, empty, error and denied.

Focused tests cover URL validation/copy, sanitization, cache deduplication and
cancellation, source binding, explicit-host archive/target routing, failed/stale
navigation, lease cleanup, end-of-history anchors, adopted connection callbacks,
event/removal isolation and per-environment drafts. Live cross-host acceptance
uses a current desktop, phone and CLI build: verify desktop local↔CLI and phone
desktop↔desktop/CLI clicks, control takeover, offline preparation and source draft
recovery. Mock/protocol tests alone do not establish that device-level acceptance.

## Acceptance status (2026-10-07)

Claude reviewed the final changes and agreed after desktop, iOS simulator and
loopback CLI verification. The iOS run used an iPhone 17 Pro Max simulator,
not a physical phone. Verified paths include desktop local↔CLI, mobile
desktop↔CLI, message-owner `localhost`, metadata icons, long-title selection and
Markdown copy, source drafts, unknown/offline target protection, duplicate user
echoes and refreshed remote history. Returning from CLI to a desktop new-session
page restores that desktop's defaults for the same harness; reopening existing
sessions retains their own settings.

Cold settings failures and stale callbacks have unit-test and code-review
coverage only. They were not injected into the live mobile run. Shared control
through one authenticated desktop gateway was verified; takeover by an
independent client was not.

Other paths without live coverage: a second desktop, a genuine same-session-ID
collision across hosts, Mosaic, desktop narrow layout, mobile landscape sidebar,
slow preflight/busy interaction, and mobile workspace long-press menus/search
input. These remain explicit acceptance boundaries. All tester-owned services
were stopped and the simulator was released after verification.

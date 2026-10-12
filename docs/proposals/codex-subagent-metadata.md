# Codex subagent configuration and turn provenance

Status: draft · Updated: 2026-10-11

## Goal

Make a native Codex subagent's creation model and reasoning effort visible from
its existing card. Preserve the current expand/open/return interactions on desktop
and phone. Follow with originating-turn attribution using real provider identities.
The data layer is implemented; UI consumption and activity-card lifecycle projection remain proposals. See the [data contract](../harness/codex/contracts.md#subagent-creation-metadata-and-turn-provenance).

## Current surfaces

- Native Codex subagents arrive as `Agent` content blocks
  (`packages/shared/src/codex-content.ts`) and render through the shared
  `SubagentBlockPresenter`, like every harness's subagent. The title row contains
  identity, task text, state and statistics; adding a model there would compete
  with those fields.
- The desktop card's full view opens the child transcript with a return control
  and identity header. Phone expands the shared card in place; it does not
  expose that desktop full-view action.
- `CodexCollabAgentState.requestedConfiguration` retains legacy requested spawn
  values. `CodexTurnInfo.subagents` retains native activity records and resolved
  creation values. Shared metadata events persist and project these fields without
  creating new card items; the UI does not consume them yet.
- SuperOne-launched collaboration already has launch-config detail rows. Launch
  settings and native Codex's confirmed creation settings remain distinct sources.

## Placement and interaction

### Collapsed and expanded cards

Keep the first row's existing identity, role/task text, state and statistics.
When any configuration is available, add one secondary line beneath it, aligned
with the title text:

```text
reviewer  explorer                         4 tools · 48.2k  >
GPT-6.1 Sol · High
```

- Use the same small muted typography as card statistics. Model and effort are
  read-only text, without dropdown arrows or model-selector styling.
- The existing header still expands/collapses activity. The metadata line belongs
  to that header; it does not introduce a second navigation or a nested button.
- Reuse the model display-name formatter and existing effort labels (`High`,
  `Extra High`, etc.). Preserve unknown model IDs/effort values rather than mapping
  them to an unrelated known option. Move reusable formatting to a shared leaf
  if needed; do not copy desktop-only helpers into the phone bundle.
- At narrow widths, preserve identity and state; allow task text to truncate as
  today. The metadata line gives the model the flexible space and retains the
  effort label. Full values are available in the expanded details on both devices.
- Expanded activity begins with a compact, optional `Creation configuration`
  disclosure: full model ID/name, reasoning effort and whether the values were
  reported by Codex or only requested. Existing activity and result sections follow.
- A failed/stopped task retains its last known configuration. Failed-row variants
  need an accessible way to reveal details without replacing the diagnostic.

### Desktop child transcript

Keep the existing return control, child identity and turn count. Add the same
read-only summary beneath the identity header, labeled `Creation configuration`
in its detail disclosure. Do not put the child's values into the parent session's
composer/model selector.

### Phone

Use the same presenter and formatting as desktop. The summary stays visible while
collapsed and without fetching full tool detail. Expanded details contain the
complete values; essential information never depends on hover. Preserve the
existing inline expansion instead of introducing a new phone navigation screen.

## Meaning and incomplete data

| Available data | Summary | Details |
|---|---|---|
| Confirmed model and effort | `GPT-6.1 Sol · High` | Creation values reported by Codex |
| Confirmed model only | `GPT-6.1 Sol` | Effort: Not provided |
| Confirmed effort only | `Reasoning: High` | Model: Not provided |
| Requested values only | `GPT-6.1 Sol · High · Requested` | Actual creation values: Not provided; requested values shown separately |
| No values, including old history | No extra summary line | Missing fields read Not provided when other details warrant a disclosure |
| Confirmed values arrive later | Replace requested/partial summary in place | Keep identity and expanded state stable |
| Later activity has null metadata | Retain known creation values | Interaction/termination records do not erase creation configuration |

The confirmed fields are a creation snapshot, not proof of the model used in every
later turn. Never fill unknown values from the parent's current model, effort or
defaults. A subsequent explicit per-turn configuration should be presented on
that turn, not silently substituted into the creation snapshot. Requested and
confirmed provenance is tracked per field so partial confirmation is not overstated.

## Data and rendering contract

- Normalize `subAgentActivity` (`started`, `interacted`, `interrupted`, `completed`)
  into the existing native subagent presentation and child lifecycle. Identify
  children by `agentThreadId`; do not create duplicate cards if legacy collab
  records and activity records describe the same child.
- Store creation metadata per child thread within its provider/session scope,
  alongside the existing agent state. Keep requested spawn settings separately
  from confirmed settings. Do not place one child's model on an entire multi-child
  `wait` item or assume the first receiver represents every child.
- The compact projection carries these scalar fields to the phone; it must not
  require downloading `childItems`. Deferred detail merges preserve newer live
  metadata. Persisted/replayed history and resumed child views use the same data.
- Introduce one shared read-only summary/detail presentation and reuse it in the
  shared card, grouped desktop card and desktop child header. Optional data keeps
  other harnesses and old histories compatible; no harness-specific UI branch.
- Consolidate the new normalization between desktop and `packages/codex`; avoid
  implementing two independent creation-metadata merge policies.

## Parent and root turns: follow-on design

`parentTurnId` is the directly originating turn. `rootTurnId` identifies the first
turn of that work chain. These are per-turn relationships, not permanent agent
ancestry; a reused child can receive work from a different originating turn.

- Keep the collapsed card focused on model/effort. In expanded details and the
  selected child-turn view, show readable `Originating turn` and `Root turn`
  links using session/task names and short message descriptions when resolved.
- Resolve links against provider turn identities scoped to environment, provider
  thread and SuperOne session. Raw IDs go into a collapsed technical-details area.
- Use the existing navigation stack to return to the immediate parent. Do not
  replace it with an unconditional jump to the root conversation.
- Only resolved, accessible targets are clickable. Unknown or unavailable origins
  remain read-only; do not invent a task chain from notification arrival order.
- Send genuine parent/root provider IDs when SuperOne starts a new delegated Codex
  turn and the source is known. Direct user turns leave `parentTurnId` unset;
  steering an active turn does not establish a new relationship.
- Cross-provider collaboration retains SuperOne's own relationship contract;
  local request/message IDs are not fabricated Codex turn IDs. Attribution does
  not grant or share authorization: permissions remain separately checked.

## Verification for implementation

Stories and scoped tests should cover collapsed/expanded, desktop/phone,
light/dark, 320/390px widths, long model IDs/task names, partial/missing/requested
values, late confirmation, failure/stopped states, multiple receivers, nested
agents, replay/resume, compact remote projection and stale deferred detail.
For provenance, cover unknown origins, inaccessible remote targets, reused child
turns with distinct parents, and return to the immediate parent.

## Sources inspected

- Pinned `rust-v0.162.1` protocol: `ThreadItem.subAgentActivity`,
  `SubAgentActivityKind`, `TurnStartParams.parentTurnId/rootTurnId`, `Turn.rootTurnId`.
- [Codex item translation](../../packages/shared/src/codex-content.ts),
  [shared subagent presenter](../../packages/chat-view/src/presenters/SubagentBlock.tsx),
  [portable adapter](../../packages/chat-view/src/PortableTurnAdapters.tsx),
  [desktop subagent card](../../apps/desktop/src/renderer/src/components/chat/SubagentBlock.tsx).

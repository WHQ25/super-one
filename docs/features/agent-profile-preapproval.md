# Saved Agent Profile preapproval

Agent Profiles is experimental and disabled by default. Enable **Settings → General → Experimental → Agent Profiles** before using the settings page, Profile tools, or preapproved Profile launches. Turning it off preserves saved Profiles and existing sessions. Node hosts opt in separately with `settings.patch({ patch: { experimentalAgentProfilesEnabled: true } })`; omission defaults to off.

Saving or updating an Agent Profile through `agent_profile_apply` uses the existing
user confirmation. That confirmation reviews the definition and final effective
launch defaults and explicitly authorizes future collaboration within that scope.
No additional configuration entity or workflow engine is involved. Children still
start only when the agent calls `session_collab_start` with a task.

The desktop also provides **Settings → Agent → Agent Profiles**, below Harnesses.
Default Profiles show live settings and link to their harness preferences; saved
Profiles can be created, edited and deleted. **Save & Approve Collaboration**
reviews the effective configuration and atomically stores the definition and its
consent. Stale definitions/defaults are rejected, and deletion rebinds existing
stored and live Sessions to the harness base row. These human-only settings IPC
handlers do not expose the raw Profile writer through generic provider RPC.

The agent-facing setup guide and Coordinator pattern are served by
`read_manual({ domain: "product", topic: "agent-profiles" })` from
[the Profile manual](../../apps/desktop/src/main/mcp/guides/product/agent-profiles.md).

## Scope

Each canonical built-in row is its harness's dynamic Default Profile. No copy of
the user's settings is stored in `config.profile`: listings and new launches
resolve current defaults, including model, effort, account, permission, sandbox
and supported options. The ACP default follows the selected protocol agent;
saved Profiles with pinned agents retain their identities. Codex's native
`read-only` default is preserved separately from shared permission modes.

Exact local same-project Default Profile launches need no additional approval.
Changes to user settings are adopted when creating the next Session, including
pending requests. Existing children and retries retain their initial settings.
Headless nodes derive their defaults from their local catalog/provider bindings.
Overrides, remote targets and other scopes retain normal confirmation.

Only non-base saved Profiles receive fingerprinted approval records. Historical
saved rows remain unapproved. An unchanged historical Profile can be reviewed with
`agent_profile_apply({ action: "update", id })`. A normal one-time collaboration
confirmation does not approve future launches.

The confirmation shows the Profile instructions, model, effort, permission mode,
sandbox, selected provider/account and harness options. Editable create proposals
recompute their effective preview using the captured defaults and catalog. If
those defaults or the provider change during review, the proposal must be reviewed
again. Approval is stored only for the configuration actually shown and saved.

Approval covers local spawn and handoff launches with the exact reviewed runtime
in the requesting Session's default collaboration directory (the project root
when the requester itself uses a worktree). It also covers host-managed new
branch or detached worktrees in that repository, without copying local changes.
Task text, name and role are chosen per launch. Alternate projects/directories,
remote targets, links, existing-worktree attachment, copied local changes and
runtime overrides retain normal launch confirmation. The authorization is reusable
across requesting Sessions; it is not tied to one coordinator or a saved workflow.

## Persistence and invalidation

The additive `agent_profile_approvals` table stores a Profile id, SHA-256
fingerprint and approval time. Its foreign key deletes approval when the Profile
is deleted; recreating the same id does not restore it. There is no separate
revocation control. The fingerprint includes the definition and final launch
defaults, plus the actual resolved provider endpoint, protocol, credentials,
model mapping and environment settings. Sensitive provider values are hashed
locally and never included in the consent payload or stored as plaintext here.
Subscription account selections are bound by their account id and display identity;
the provider resolver does not expose subscription authentication tokens.

ACP consent also binds the final resolved protocol agent id. Historical ACP
Profiles without a pinned `config.agentId` may follow a global or cached agent
selection; changing that selection invalidates their saved approval and pending
launches even when model and effort are unchanged. An unresolved ACP identity
cannot reuse saved consent. The confirmation shows the resolved agent explicitly.

Model, default, Profile or provider changes invalidate reuse. Restore the reviewed
configuration or review the Profile again. Database reopen preserves unchanged
approval. Closing a coordinator does not revoke this saved consent.

## Request, start and retries

`session_collab_request` checks every normalized launch against its saved approval.
Only launches outside the approved scope appear in the regular confirmation. A
rejected or canceled mixed batch creates no grants. Accepted batches revalidate
preapproved Profiles before atomically creating grants.

The host marks Default Profile grants as following defaults, refreshing their
runtime fields after asynchronous project/worktree preparation and before
creation. Agent input cannot provide this marker. Saved Profile grants instead
keep their reviewed configuration.

The host marks grants that reused saved consent with the reviewed fingerprint and
working directory. Agent input cannot supply this bookkeeping. `session_collab_start`
revalidates before side effects, after asynchronous project/worktree preparation,
and after applying Session settings before sending the initial task. A deleted or
changed Profile requires a new request. Existing runtime/profile prompt hydration
continues to use the ordinary Session path; this feature adds no prompt injection.

Simultaneous starts of the same caller/launch share one in-flight operation. A
completed retry returns the existing Session without resending its brief. A failed
initial send can retry the original stored brief, including after a handoff id has
been persisted. Existing closed/read-only/deleted Session checks remain in force.
Durable grants and approval fingerprints survive host restart; in-flight promises
are process-local and do not implement distributed scheduling or exactly-once
runtime creation across a process crash.

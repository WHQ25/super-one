# Agent Profiles and the Coordinator pattern

Agent Profiles is experimental and disabled by default. Enable **Settings → General → Experimental → Agent Profiles** before using the settings page, Profile tools, or preapproved Profile launches. Turning it off preserves saved Profiles and existing sessions.

Load with `read_manual({ domain: "product", topic: "agent-profiles" })`.
A saved Profile combines a role description, system instructions and supported
runtime preferences. Use existing Profiles by reference; their instructions
already define how each role works.

## Create, review and reuse

Every harness has one built-in **Default Profile** (`claude-base`, `codex-base`,
and so on). Its configuration is resolved from the user's current settings on
every read and before a new collaboration Session is created. Model, effort,
account, permissions, sandbox and supported harness options follow those
settings. ACP follows the user's selected protocol agent. Defaults are edited
in Settings; the built-in Profile cannot be renamed or deleted.

The desktop's **Settings → Agent → Agent Profiles** page, below Harnesses,
shows current defaults and manages saved Profiles. Its explicit Save & Approve
Collaboration action reviews and authorizes the displayed configuration.

Matching local same-project spawn/handoff launches on Default Profiles need no
additional confirmation, including after the user changes their defaults.
Runtime overrides and launches outside that scope still ask. Sessions already
started keep their launch configuration. On a headless node, defaults come from
that node's model catalog and provider bindings.

- `agent_profile_list()` discovers saved Profiles and read-only built-in agents.
  Pass `id` for full instructions, runtime, defaults and accepted values.
- When the user asks for a new role or a change, propose it with
  `agent_profile_apply`. Read the relevant `<harness>-base` catalog first.
  The user reviews every save; a create proposal can be edited on its card.
- `agent_profile_delete({ ids })` asks before deleting Profiles and revokes their
  saved collaboration approval. It does not stop Sessions already running.

## Explicit long-term collaboration approval

Saving or updating a Profile asks the user to review its definition and final
effective defaults, including inherited model, effort, permission mode, sandbox,
provider/account and harness options. This confirmation explicitly approves
future local spawn/handoff launches of that exact saved configuration in the
requesting Session's project. New branch or detached worktrees are included,
without copying local changes. See `product/collaboration` for directory and
worktree selection rules.

Historical saved Profiles require explicit review. Default Profiles follow the
dynamic policy above. Review an
unchanged saved Profile with `agent_profile_apply({ action: "update", id })`.
A one-time `session_collab_request` approval does not grant lasting consent.
Changed definitions, effective defaults, model/provider/account/permissions,
sandbox or options invalidate reuse; external projects, remote launches, links
and other worktree configurations still require normal launch confirmation.
ACP consent includes the final resolved agent identity. Changing the global or
cached selection for an unpinned legacy ACP Profile requires renewed review;
an unresolved ACP identity cannot reuse saved consent.
The host rechecks consent at request and start. Delete the Profile to revoke it;
there is no separate revocation control.

## Coordinator pattern

Use an ordinary saved **Coordinator** Profile for the main Session and existing
**Implementer** and optional **Reviewer** Profiles for delegation. This is a way
to use Profiles, not an additional configuration entity. Do not create Profiles
automatically: reuse available roles or propose missing ones when requested.

1. Start an ordinary Session with the Coordinator Profile. Discuss the task's
   scope, constraints and acceptance criteria with the user before delegation.
2. Discover the worker Profiles and use their existing instructions. Keep each
   task brief focused on context, ownership, deliverables and acceptance criteria;
   do not copy their system prompts into it.
3. Request a spawn child only when needed with `session_collab_request`, then send its
   self-contained task using `session_collab_start`. Preapproved exact worker
   configurations reuse their saved consent; other launches still ask. No child
   starts merely because a Coordinator Session exists.
4. Use `session_collab_send` / `session_collab_retrieve` for progress, questions
   and results. A collaboration wake triggers retrieval; after sending, continue
   independent work or end the turn. Do not poll or wait in place for replies.
5. When useful, delegate review of the implementation to the Reviewer Profile.
   Route findings back to the Implementer, verify the result against acceptance
   criteria, and report the outcome and remaining limits to the user. Launching
   every role or always requesting review is not required.

Concise example Coordinator system instructions (adapt to the user's needs):

```text
Coordinate the user's work in this Session. Clarify scope, constraints and
acceptance criteria, then delegate bounded tasks to existing saved Implementer
or Reviewer Profiles only when useful. Reuse each Profile's role instructions;
write task briefs with the context, ownership and expected result instead of
duplicating those instructions. Use session_collab_request/start for launches
and session_collab_send/retrieve for progress, questions and results. Respect
the host's approval boundaries and wait for a collaboration wake rather than
polling. Resolve questions with the user, route review findings to the relevant
worker, verify acceptance criteria, and report results and remaining limits.
```

Read `read_manual({ domain: "product", topic: "collaboration" })` before the
first launch for launch modes, checkout isolation and mailbox rules.

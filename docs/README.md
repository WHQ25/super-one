# SuperOne docs

`docs/` holds three kinds of documents:

- **Long-term docs** describe how SuperOne works now. They change in the same
  commit as the code they describe, and code comments may cite them.
- **Proposals** discuss direction before it is built: macro designs, options,
  decisions and open questions. They live in `docs/proposals/`.
- **Plans** track execution: steps, spikes, investigations, validation logs and
  progress. They live in `docs/plans/` and are deleted when the work is done.

Knowledge that concerns a single workspace belongs in that workspace's manuals
(`apps/<workspace>/docs/`, routed from its `CLAUDE.md`), not here.

## Where a document goes

| Content | Location |
|---|---|
| Cross-workspace system design: contracts, protocols, persistence, ownership | [architecture/](#architecture) |
| A user-facing capability spanning desktop, mobile or remote node | [features/](#features) |
| One harness's upstream surface, contracts, upgrades | [harness/](harness/README.md) |
| Repository conventions and workflow | [development/](#development) |
| One workspace's internals, testing, release steps | `apps/<workspace>/docs/` |
| Direction under discussion or decided but not yet built | `docs/proposals/<slug>.md` |
| Execution and progress of work | `docs/plans/<slug>.md` |
| Scratch that should not be shared | `docs/temp/` (gitignored) |

## Long-term docs

State the current behavior and the decisions behind it. Leave out progress
markers, phase tables, dated logs and checklists; those belong in a plan and
in git history. When code changes what a long-term doc says, update the doc in
the same commit.

### Architecture

- [chat-core.md](architecture/chat-core.md) — shared reducer, patch contract, host protocol
- [session-sync-zone.md](architecture/session-sync-zone.md) — session files across hosts
- [remote-node-service.md](architecture/remote-node-service.md) — the remote node
- [mobile-remote-control.md](architecture/mobile-remote-control.md) — phone ↔ host protocol: framing, batching, progressive loading, attachments
- [relay-crypto.md](architecture/relay-crypto.md) — relay encryption and golden vectors

### Features

- [subscription-usage.md](features/subscription-usage.md) — quota estimates and reset-aware warnings
- [widgets.md](features/widgets.md) — `widget_show`: the short model result, drawing widgets from the call input, templates
- [inline-files-previewer.md](features/inline-files-previewer.md) — `@native/files-previewer`
- [3d-model-preview.md](features/3d-model-preview.md) — 3D formats, samples, USDZ composition
- [terminal-agent-tools.md](features/terminal-agent-tools.md) — agent terminal control
- [jev-fast-loop.md](features/jev-fast-loop.md) — Jev fast loop for browser, computer and device runs
- [mcp-apps.md](features/mcp-apps.md) — hosting third-party MCP Apps Views (Codex, Claude; desktop, phone, remote)
- [claude-mods.md](features/claude-mods.md) — drawing Claude Code mods (panes, band, transcript sites, `Client`; desktop, phone, remote)
- [composer.md](features/composer.md) — desktop composer slot, decision queue, and focus and draft rules
- [session-links.md](features/session-links.md) — session Markdown chips, source ownership and environment-scoped archive discovery

### Development

- [repository.md](development/repository.md) — workspace layout and TypeScript resolution
- [commit-messages.md](development/commit-messages.md) — commit format

## Proposals

One file per proposal, `docs/proposals/<slug>.md`, starting:

```
# <Title>

Status: draft | accepted | rejected | superseded · Updated: <YYYY-MM-DD>
Plan: <link, once accepted>
```

A proposal stays macro: goals, decisions, options, contracts, phases and open
questions. Update it in place as the discussion moves; the status says whether
it is settled.

- **Accepted**: execution gets a plan under the same slug.
- **Rejected**: keep the file, trimmed to the conclusion and the reasons, so the
  idea is not reopened without new facts.
- **Superseded**: point to the replacing proposal, then delete once nothing
  links to it.

## Plans

One file per piece of work, `docs/plans/<slug>.md`, using the proposal's slug
when there is one. Use a `docs/plans/<slug>/` folder only when parallel tracks
need separate files. A plan starts:

```
# <Title>

Status: planned | in-progress | blocked · Updated: <YYYY-MM-DD>
Goal: <one sentence>
Proposal: <link, if any>
Long-term docs affected: <links>
```

Small work needs no proposal. When the work is done, in the commit that
completes it:

1. Move what stays true into the long-term docs, workspace manuals, harness
   docs, `CLAUDE.md` or skills: decisions, invariants, traps, how to verify.
2. Point code comments at those long-term docs. Code never cites a proposal or
   a plan.
3. Delete the plan and its accepted proposal. Git history keeps them.

Dropped work is deleted the same way, after recording why in the relevant
long-term doc or rejected proposal if the decision matters later.

## Translations

English is the source. A translation sits next to its source as
`<name>.<locale>.md` and states the source commit it was translated from.

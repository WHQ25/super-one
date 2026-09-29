# SuperOne docs

`docs/` holds two kinds of documents:

- **Long-term docs** describe how SuperOne works now. They change in the same
  commit as the code they describe, and code comments may cite them.
- **Task docs** are working notes for one piece of work in progress: plans,
  spikes, investigations, validation logs. They live in `docs/tasks/` and are
  deleted when the work is done.

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
| Work in progress | `docs/tasks/<task-slug>/` |
| Scratch that should not be shared | `docs/temp/` (gitignored) |

## Long-term docs

State the current behavior and the decisions behind it. Leave out progress
markers, phase tables, dated logs and checklists; those belong in a task doc and
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
- [inline-files-previewer.md](features/inline-files-previewer.md) — `@native/files-previewer`
- [3d-model-preview.md](features/3d-model-preview.md) — 3D formats, samples, USDZ composition
- [terminal-agent-tools.md](features/terminal-agent-tools.md) — agent terminal control
- [jev-fast-loop.md](features/jev-fast-loop.md) — Jev fast loop for browser, computer and device runs

### Development

- [repository.md](development/repository.md) — workspace layout and TypeScript resolution
- [commit-messages.md](development/commit-messages.md) — commit format

## Task docs

One folder per task, `docs/tasks/<task-slug>/`, with a `README.md` that starts:

```
# <Task title>

Status: planned | in-progress | blocked · Updated: <YYYY-MM-DD>
Goal: <one sentence>
Long-term docs affected: <links>
```

Split into more files in the same folder when the task needs it.

When the task is done, in the commit that completes it:

1. Move what stays true into the long-term docs, workspace manuals, harness
   docs, `CLAUDE.md` or skills: decisions, invariants, traps, how to verify.
2. Point code comments at those long-term docs. Code never cites a task doc.
3. Delete the task folder. Git history keeps it.

A task that is dropped is deleted the same way, after recording why in the
relevant long-term doc if the decision matters later.

## Translations

English is the source. A translation sits next to its source as
`<name>.<locale>.md` and states the source commit it was translated from.

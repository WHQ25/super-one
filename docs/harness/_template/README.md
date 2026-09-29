# <Harness name> integration

Pin: `<package>` `<version>` · Ledger version: `<version>` · Last updated: <YYYY-MM-DD>

## Upstream

- Package / binary: <npm package, release channel>
- Changelog: <link>
- Surface source: <types file, generated schema, protocol spec>

## Integration shape

<Process model, transport, where upstream output becomes `AgentEvent`, and which
SuperOne runtimes use this harness (desktop, remote node, probes). Link entry
files.>

## Pin locations

Every place an upgrade must change, and the test that keeps them in lockstep.

| Location | What |
|---|---|
| `<path>` | <dependency or constant> |

## Documents

- [api-surface.md](api-surface.md) — upstream interfaces and how SuperOne uses them
- [contracts.md](contracts.md) — upstream behavior SuperOne depends on
- [backlog.md](backlog.md) — unused capabilities and decisions
- [upgrades/](upgrades/) — one document per version bump

## Version history

| Version | Date | Status | Upgrade doc | Commit |
|---|---|---|---|---|

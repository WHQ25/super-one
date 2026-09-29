# Harness integration docs

One folder per harness, named by its `HarnessId` (`packages/shared`), tracking the
upstream surface SuperOne integrates with: what exists, what we use and how, what
we rely on implicitly, and how each version bump was planned and landed.

These docs are per harness and follow upstream's shape. The cross-harness view
per capability lives in the `superone-harness` skill
([experiences.md](../../.agents/skills/superone-harness/references/experiences.md));
link a ledger row there instead of repeating it. How managed runtimes are
downloaded, installed and gated is in [runtime-delivery.md](runtime-delivery.md).

| Harness | Pin | Ledger |
|---|---|---|
| [claude](claude/README.md) | `@anthropic-ai/claude-agent-sdk` 0.3.284 | 0.3.284, script-checked |
| [codex](codex/README.md) | `@openai/codex` 0.155.1 | not started |
| [dsh](dsh/README.md) | `@deepseek-ai/dsh-*` 0.1.7-rc.1 | not started |
| [cursor](cursor/README.md) | `@cursor/sdk` 1.0.30 | not started |
| [opencode](opencode/README.md) | `@opencode-ai/sdk` ^1.18.26 | not started |
| [acp-grok](acp-grok/README.md) | `@agentclientprotocol/sdk` ^1.4.0 | not started |

## Folder layout

```
docs/harness/<harness-id>/
├── README.md            # overview, pin locations, version history
├── api-surface.md       # ledger: every upstream interface and how we use it
├── contracts.md         # upstream behavior we depend on that types do not state
├── backlog.md           # unused capabilities and the decision on each
└── upgrades/<version>.md
```

Copy [`_template/`](_template/) to start a harness. A multi-part upgrade may be a
folder `upgrades/<version>/` with its own `README.md`. Other harness-specific files
(design packs, spikes) sit next to these under their own names and are listed in the
harness README.

A ledger starts with the first upgrade planned after the harness gets an exact pin;
until then `api-surface.md`, `contracts.md` and `backlog.md` are stubs.

| Document | Changes by | Answers |
|---|---|---|
| `README.md` | editing in place | What is pinned, where, how it is wired, what versions shipped |
| `api-surface.md` | editing in place, always for the current pin | Does upstream offer X, do we use it, where |
| `contracts.md` | editing in place; entries are retired, not deleted | Which non-obvious behavior would break us if it changed |
| `backlog.md` | editing in place | Did we already decide on X, and why |
| `upgrades/<version>.md` | append-only after `executed` | What changed in that bump and how we absorbed it |

## Ledger (`api-surface.md`)

- The header states the version the ledger describes. It must equal the pin once
  an upgrade is executed.
- One `## <Category>` section per upstream category; category names are fixed per
  harness and match the inventory script.
- Each row is `` | `name` | status | Usage | Code | ``. The first cell is the exact
  upstream name in backticks; the script matches on it.
- **Code** lists repo-relative paths, optionally with `#symbol`. No line numbers:
  they rot on every edit.
- A row describes the current pin only. History goes in upgrade docs.

Status vocabulary, shared by every harness:

| Status | Meaning |
|---|---|
| `used` | SuperOne relies on it |
| `partial` | Used in some runtimes or only some fields/modes; Usage says which |
| `unused` | Not used and could matter; a `backlog.md` entry may exist |
| `n/a` | Not applicable to SuperOne; Usage says why |
| `deprecated` | Upstream marks it deprecated; Usage says what replaces it |

Removed upstream interfaces are deleted from the ledger and recorded in the
upgrade doc that removed them.

`bun scripts/harness-api-inventory.ts <harness>` extracts the upstream names for
the pinned version and reports ledger rows that are missing or no longer
upstream. `--list` prints the inventory. Harnesses without an extractor keep the
ledger by hand.

## Contracts (`contracts.md`)

Each entry: the behavior, the version range it was observed in, the SuperOne code
that depends on it, and what guards it (test, recording, or "unguarded"). Mark an
entry `Retired in <version>` rather than deleting it, so the history of a trap
stays findable.

## Backlog (`backlog.md`)

One row per unused capability worth a decision: introduced version, benefit,
cost or risk, and decision (`open`, `adopt`, `rejected`) with the reason.
Rejected rows stay so the question is not reopened every upgrade.

## Upgrade docs (`upgrades/<version>.md`)

Status is one of `planned`, `in-progress`, `executed`, `abandoned`. Items inside
use `[PLANNED]` (this round implements it), `[VERIFY]` (existing behavior to
regress), `[DEFERRED]` (moved to the backlog).

Sections, in order: scope, upstream changes, surface diff, required changes,
adopted capabilities, verification, follow-ups. The template has the details.

## Upgrade workflow

1. Read the upstream changelog and diff the published types or schema against
   the current pin.
2. Write `upgrades/<version>.md` as `planned`: classify each upstream change,
   list required changes and candidates.
3. Bump every pin listed in the harness README, install, and implement.
4. Run the inventory script; update `api-surface.md` rows and its header version.
5. Update `contracts.md` for behavior that changed and `backlog.md` for new or
   decided capabilities.
6. Verify (typecheck, affected tests, live smoke where the change needs it) and
   record the result in the upgrade doc.
7. Add the user-facing `CHANGELOG.md` entry, mark the upgrade `executed`, and add
   the row to the README version history.

## Translations

English files are the source. A translation sits next to its source as
`<name>.<locale>.md` (for example `api-surface.zh-CN.md`) and states in its header
the source commit it was translated from. Only translate files that are stable
enough to be worth it; upgrade docs normally stay in their original language.

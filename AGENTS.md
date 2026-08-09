# Agent instructions

Repo-wide monorepo guidance lives in sibling [`CLAUDE.md`](./CLAUDE.md)
(layout, commands, cross-package resolution, conventions).

Agents that only load `AGENTS.md` and do **not** expand `@` includes **must read**
`./CLAUDE.md` before large or cross-cutting work in this repository.

@CLAUDE.md

# Commit Message Guideline

Every commit in this repo follows this guideline. Agents MUST comply. Read the whole
file before writing a commit — most bad commits come from skipping the "why", not from
getting the format wrong.

## Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

Only the first line (`<type>(<scope>): <subject>`) is mandatory. Body and footer are
added only when they carry information the diff cannot.

## Rules at a glance

- Language: **English only** — subject, body, and footer. No exceptions.
- Subject: imperative mood, lowercase start, no trailing period, ≤ 72 chars.
- One commit = one logical change. Do not bundle unrelated work.
- The subject states **what changed**; the body explains **why** (and what the reader
  can't infer from the diff). Never let the body just re-narrate the diff.

## Type

Pick the single most accurate type. If two seem to fit, the one describing the *user- or
system-visible outcome* wins (a bug fixed via refactor is `fix`, not `refactor`).

| Type       | Use for                                                              |
|------------|---------------------------------------------------------------------|
| `feat`     | A new capability or user-visible behavior                           |
| `fix`      | A bug fix — wrong behavior becomes correct                          |
| `refactor` | Restructuring with **no** behavior change                           |
| `perf`     | A change whose point is speed/memory/latency                       |
| `docs`     | Documentation only                                                  |
| `test`     | Adding or fixing tests only                                         |
| `style`    | Formatting/whitespace/naming with no logic change                  |
| `build`    | Build system, bundler, packaging, electron-builder                 |
| `chore`    | Deps, config, release bumps, tooling — no src/product change       |

## Scope

The scope is the **subsystem or workspace** the change lives in, lowercase, one token.
Prefer an established scope over inventing a new one. Omit the scope (`type: subject`)
only when the change is genuinely repo-wide.

- Workspace-level: `desktop`, `web`, `relay`, `ui`, `shared`.
- Subsystem-level (inside desktop): e.g. `chat`, `session`, `mosaic`, `browser`,
  `terminal`, `providers`, `mcp`, `codex`, `sidebar`, `settings`, `widget`, `media-gen`.

Rules:
- Choose one scope. If a change truly spans several, either split the commit or scope it
  to the workspace (`desktop`).
- Keep scope names stable and singular in style; don't alternate `provider`/`providers`
  for the same subsystem.

## Subject

The subject is the line people read in `git log --oneline`. Make it specific and
self-sufficient.

- **Imperative mood**: "add", "remove", "fix", "rename" — as if completing "This commit
  will _____". Not "added", not "adds".
- **Concrete object**: name the thing that changed. A reader should know what to expect
  before opening the diff.
- **No filler**: drop "improve", "update", "enhance", "refine", "tweak", "some",
  "various" unless you immediately say *what* and *how*. "improve X UX" is banned — it
  says nothing.
- Lowercase first word, no period, ≤ 72 chars.

```
✅ fix(session): release idle runtime after retention window elapses
✅ feat(chat): add per-provider model selector to the composer
✅ refactor(mosaic): extract tile layout into usePaneLayout hook

❌ feat(codex): improve goal lifecycle UX        # what improved? how?
❌ fix(chat): update stuff                        # says nothing
❌ Added new terminal shortcuts.                   # past tense, capitalized, period
❌ feat: various fixes and refactors              # bundles unrelated work
```

## Body

Include a body only when the subject alone leaves an informed reviewer asking "why?" or
"why this way?". When you do write one:

- Explain **motivation and reasoning** — the problem, the constraint, the trade-off, the
  root cause. This is the part the diff can never show.
- Describe **consequences** a reviewer should know: behavior changes, migration needs,
  known limitations.
- Do **not** enumerate the diff. A body that is a bullet list of "changed file A, changed
  file B" is noise — delete it. If a list is genuinely useful, list *decisions*, not
  *edits*.
- Wrap at ~72 columns. Separate from the subject with one blank line.

```
fix(providers): normalize custom Google API base URLs

Users pasting a base URL with a trailing /v1 produced doubled path
segments and 404s. Strip a trailing version segment before building the
request URL so both bare-host and versioned URLs resolve identically.
```

## Footer

- **Breaking changes**: start a footer line with `BREAKING CHANGE:` followed by what
  broke and the migration path. This is required whenever behavior or an API changes in a
  non-backward-compatible way.
- **References**: `Refs #123`, `Closes #123` on their own lines.

```
feat(relay): require per-device ACK for buffer GC

BREAKING CHANGE: relay clients older than v2 never ACK and will leak
buffer entries. Upgrade the desktop client before deploying this relay.

Closes #482
```

## Checklist before committing

1. Does the type match the *outcome* (not the mechanism)?
2. Is the scope an existing, single, correct subsystem?
3. Could a teammate predict the diff from the subject alone?
4. Is the subject imperative, lowercase, period-free, ≤ 72 chars, English?
5. If there's a body: does it explain **why**, not restate the diff?
6. Is this one logical change — nothing unrelated smuggled in?

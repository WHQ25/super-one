---
name: release
description: Release SuperOne desktop builds or mobile native/OTA updates using the repository release workflows.
arguments: "[desktop|mobile] [alpha|stable|ota] [major|feature|patch|build]"
argument-hint: "desktop [alpha|stable] [major|feature|patch|build] | mobile ota | mobile [major|feature|patch|build]"
compatibility: "Requires git, gh, bun, npm, curl, jq, GitHub Actions access, an EAS login for mobile, and network approval for GitHub, npm, expo.dev and dl.super-one.dev."
---

# Release Skill

Two products, one entry point. Route on the first argument, then read **one**
reference file and follow it end to end:

| Command | Reads | What it does |
|---|---|---|
| `/release desktop alpha build` | `references/desktop.md` | Desktop app: bump → CHANGELOG → `release.yml` (builds + promote + CLI / harness / relay legs) → publish → set-latest |
| `/release alpha build` (no product word) | `references/desktop.md` | Same — `alpha` / `stable` in first position means desktop |
| `/release mobile ota` | `references/mobile.md` → **OTA** | Mobile JS bundle to installed apps via `update-mobile.yml`; no version bump, no commit |
| `/release mobile patch` | `references/mobile.md` → **Native** | Mobile binary: bump `app.json` + build code, `release-mobile.yml` twice (android/internal, ios/production) |

Do not read both references; nothing in one flow depends on the other. The one
crossing point is written into `desktop.md` Step 1: a desktop release checks
whether a mobile OTA should ride along, and `mobile.md` is where that check is
defined.

## Arguments

**Product** — `desktop` (default when omitted, or when the first word is
`alpha` / `stable`) or `mobile`.

**Desktop**: `[alpha|stable] [major|feature|patch|build]`

- **variant**: `alpha` (default) or `stable`. Which of the two side-by-side apps
  is being released — not a channel of one app.
- **bump**: `patch` (default). `major` `0.14.3-alpha → 1.0.0-alpha`; `feature`
  `→ 0.15.0-alpha`; `patch` `→ 0.14.4-alpha`; `build` bumps the latest shipped
  alpha's sequence without moving X.Y.Z (`0.63.0-alpha → 0.63.0-alpha.1`), and
  is invalid for `stable`. A stable is a **cut** of a proven alpha commit, not a
  bump — see `references/desktop.md` → Cutting a stable release.

**Mobile**: `ota` **or** `[major|feature|patch|build]`

- `ota`: publish the current JS to the installed apps. Only possible when no
  native input changed since the last binary — the reference checks this before
  asking for confirmation, and the workflow refuses it otherwise.
- `major` / `feature` / `patch`: bump `apps/mobile/app.json` `version` at that
  position and the shared build code, then build both platforms.
- `build`: same version, next build code. The normal reason is that the runtime
  fingerprint moved (a native module or config plugin), which is exactly the
  case `ota` cannot cover.
- No variant. The mobile app is one identity; Android ships an `internal` APK
  and iOS a `production` TestFlight build, always both, never chosen.

### Which position to bump

Every commit carries a conventional-commit type, so the position is derivable
and Step 1 of either flow shows the recommendation beside the argument. **The
argument ships**; the recommendation exists so a mismatch is a decision, not an
accident.

| Commits since the previous release contain | Position |
|---|---|
| any `feat` | **feature** (minor) |
| only `fix` / `perf` / `refactor` / `style` / `docs` / `test` / `ci` / `build` / `chore` | **patch** |
| `feat!`, `fix!`, or a `BREAKING CHANGE:` footer | **feature** while pre-1.0; **major** after |

`build` is not in the table — it does not move X.Y.Z. Still show the
recommendation when `build` is passed, so choosing sequence over a new minor
is recorded. The reasoning behind this rule (with the release history that
motivated it) is in `references/desktop.md`.

## Shared rules

- **One human checkpoint per flow**: Step 1 lays out everything — numbers,
  decisions, drafted notes — in a single plain-markdown message and asks once.
  After that confirmation nothing prompts again unless something fails. Do not
  use a choice-card input for that step; the drafts are multi-line content the
  user edits inline.
- **Network approval**: every `gh …`, `eas …`, `npm view`, and verification
  `curl` talks to `api.github.com`, `expo.dev`, `registry.npmjs.org` or
  `dl.super-one.dev`, none of which the sandbox allows. Use the environment's
  approved escalation from the start rather than waiting for a sandbox denial.
- **Monitor in the foreground** with `gh run watch <id> --exit-status`; do not
  poll from a sandboxed loop, and do not verify artifacts one `curl` at a time
  when a manifest already lists them.
- **Tags are created by GitHub / the workflow, never pushed from local.**
  Desktop tags are `v<version>`; mobile tags are `mobile/<platform>/v<version>-build<N>`.
  The namespaces never mix.
- **Do not push `.github/workflows/**` to `main` while a desktop release is in
  flight** (dispatch → promote green): `gh release create --target <sha>`
  compares `<sha>..HEAD`, and a workflow change in that range demands a scope
  `GITHUB_TOKEN` cannot hold. Mobile runs are not affected — they create no
  GitHub Release.
- **`bun.lock` is never modified by a release.**

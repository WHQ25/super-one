---
name: release
description: Release SuperOne desktop builds or mobile native/OTA updates using the repository release workflows.
arguments: "[alpha|stable|mobile] [major]"
argument-hint: "alpha | stable | mobile"
compatibility: "Requires git, gh, bun, npm, curl, jq, GitHub Actions access, an EAS login for mobile, and network approval for GitHub, npm, expo.dev and dl.super-one.dev."
---

# Release Skill

The user names **what** ships; everything else is derived. Route on the first
argument, then read **one** reference file and follow it end to end:

| Command | Reads | What it does |
|---|---|---|
| `/release alpha` (or bare `/release`) | `references/desktop.md` | Next alpha: version from the stable line, CHANGELOG → desktop build + promote → publish → set-latest → `release.yml stage=publish` (CLI / harness / relay / due mobile OTA), then any due native mobile builds |
| `/release stable` | `references/desktop.md` → **Cutting a stable release** | Cuts the latest alpha as the stable `X.Y.0`, then the stable phone apps from the same commit; writes no file |
| `/release mobile` | `references/mobile.md` | Mobile only, between desktop releases: per platform, OTA or native build, whichever is due (the alpha phone apps) |

The crossing points: an alpha release's Step 1 runs `mobile.md` → **Decide**,
and the mobile updates it finds ride along in the same release; a stable cut
ends with the stable phone apps.

Desktop publication comes first. Do not dispatch CLI, harness, relay or mobile
publication alongside desktop builds. After the desktop Release is public and
set-latest succeeds, `release.yml stage=publish` checks the published tag and all
three authoritative R2 desktop feeds, then publishes from that exact tag commit.
Both stages stay in `release.yml`: npm Trusted Publishing authorizes the calling
workflow filename, so moving publishers to another caller requires new npm trust.
Do not rename the caller as part of a release-order change.

## Arguments

- **`alpha`** (default) / **`stable`** — which of the two side-by-side desktop
  apps is being released, not a channel of one app. **`mobile`** — the mobile
  app alone, on its alpha line (SuperOne Alpha on both platforms).
- **`major`** — the only override, alpha only: open the next major instead of
  what the rule below derives. Use it for a breaking change after 1.0 (Step 1
  proposes it when the range carries `!` / `BREAKING CHANGE:`) or when asked.
- Position words from the old syntax (`build`, `feature`, `patch`, `ota`) are
  not arguments. If the user passes one and it disagrees with the plan, show the
  difference in Step 1 and ship the plan unless they say otherwise.

### How the version is decided

**By where the stable line stands, not by commit types.** Features and fixes
decide what the CHANGELOG says, never the number.

| Release | Latest stable vs. latest alpha base `X.Y.Z` | Ships |
|---|---|---|
| alpha | stable below the base | `X.Y.Z-alpha.<N+1>` — iterate the base (**build**) |
| alpha | stable equals the base, or a hotfix moved past it | `X.(Y+1).0-alpha` above both — open the next **feature** |
| alpha + `major` | any | `(X+1).0.0-alpha` |
| stable | alpha base above stable | `X.Y.0` cut from the latest alpha tag's commit |
| stable | stable already at the alpha base | nothing to cut — say so and stop |

The patch position belongs to the stable line: `X.Y.1+` exists only to hotfix
a shipped `X.Y.0`. Alpha never spends it. (There is no hotfix flow yet; design
it with the first real case.) `nextAlphaRelease` in
`apps/desktop/packaged-version.cjs` is the alpha half of this table;
`references/desktop.md` has the history behind it.

## Shared rules

- **Local CI gate before every alpha or mobile release.** Run what
  `.github/workflows/ci.yml` runs on the commit being released. Its `run:` steps
  are the source of truth: today `check-deps-lock`, `typecheck`, `lint`,
  `test:quiet`, `test:runtime`, `test:cli`, `test:relay`, `test:mobile`, and
  `check:icons` inside `apps/mobile`. Start them as parallel shell calls,
  outside the sandbox (several suites bind localhost), at the beginning of
  Step 1 so they run while the plan and notes are drafted. Any red check stops
  the release: find the root cause, fix and commit it, then start Step 1 again.
  The confirmation lists each check's result. A stable cut skips the gate; it
  rebuilds an alpha commit that passed the gate when it shipped.
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
  Desktop tags are `v<version>`; mobile tags are `mobile/<platform>/v<version>-build<N>`
  (`<platform>-alpha` for the alpha apps).
  The namespaces never mix.
- **Do not push `.github/workflows/**` to `main` while a desktop release is in
  flight** (dispatch → promote green): `gh release create --target <sha>`
  compares `<sha>..HEAD`, and a workflow change in that range demands a scope
  `GITHUB_TOKEN` cannot hold. Mobile runs are not affected — their Android
  GitHub Release attaches to a tag that already exists.
- **`bun.lock` is never modified by a release.**
- **Check npm reservations after an interrupted release.** A cancelled desktop
  release may already have published its CLI version under the old flow. Read
  npm versions/dist-tags and advance the alpha sequence past any used version;
  an npm version is immutable even when its desktop tag was never created.

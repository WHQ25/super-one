---
name: release
description: "Automate the SuperOne release process: version bump, commit, per-platform build, CLI npm publish, harness R2 mirror (when pins change), promote artifacts to draft release, and publish. Trigger with /release [alpha|beta|public] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
compatibility: "Requires git, gh, bun, npm, curl, GitHub Actions access, and network approval for GitHub, npm, and dl.super-one.dev."
---

# Release Skill

Automate the SuperOne release pipeline. The pipeline has **independently retryable** phases — build, **CLI npm publish**, **harness R2 publish** (conditional), relay deploy, promote, publish, set-latest — orchestrated via GitHub Actions workflow_dispatch:

- `build-mac.yml` / `build-win.yml` / `build-linux.yml` — each builds one platform, uploads artifacts to Actions storage (30-day retention). No release side effects.
- `publish-cli.yml` — packs and publishes **`@super-one/cli`** to the public npm registry at the **same version string** as desktop (lockstep). Desktop **Other Devices → SSH → registry install** pins `@super-one/cli@<app-version>`; if this step is skipped, remote SSH bootstrap cannot install that version from npm. Auth: npm **Trusted Publishing (OIDC)** for this repo (preferred) or optional `NPM_TOKEN` secret. Independent of desktop electron-builder — fires in parallel with builds at Step 3.
- `publish-harness.yml` — **conditional**. When Claude/Codex managed pin constants (or the pack script) changed since the previous tag, `npm pack`s the pinned platform tarballs, SHA-256s them, and `aws s3 sync`s byte-exact mirrors + `harness/manifest/<channel>.json` to R2 (`https://dl.super-one.dev/harness/...`). Desktop install tries R2 first, npm registry fallback, same digest. Auth: same R2 secrets as promote (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`). Independent of electron-builder — fires in parallel with builds at Step 3 when Step 1 said yes. **Not every app release** — only when harness pins move (see Invariants).
- `deploy-relay.yml` — runs `bunx wrangler deploy` against `apps/relay/` to push the Cloudflare Worker (relay) to production. Authenticated by the repo `CLOUDFLARE_API_TOKEN` secret, so this **must** run inside Actions, never from a local terminal (the local shell typically lacks the token, and skill permissions block credential-discovery anyway). Independent of the build/promote chain — triggered in parallel with builds at Step 3.
- `promote.yml` — **archive only**. Downloads artifacts and (a) uploads them **flat** (binaries + channel ymls) to a **draft** GitHub Release (bridge-mode legacy path — legacy alpha clients embed `UPDATER_TOKEN` and pull from there — **and** the manifest source for set-latest); (b) moves the binaries into a `v${VERSION}/` subdir and `aws s3 sync`s **only the binaries** to Cloudflare R2 bucket `super-one-releases` served at `https://dl.super-one.dev`. It writes **no** root channel yml — a promoted version is archived but not yet anyone's latest (that's `set-latest`). Promote does **not** touch `harness/` keys (those are `publish-harness` only).
- Final `gh release edit --draft=false --prerelease` — flips the draft to published; GitHub then materializes the tag on `target_commitish`.
- `set-latest.yml` — **manual, decoupled from promote**. Sets a given release as a channel's latest: re-points the channel pointer yml(s) on R2 **with cascade** (setting `stable` also updates `beta`+`alpha`; `beta` also `alpha`; `alpha` only `alpha`, so alpha users still receive beta/stable builds) and refreshes the permanent `https://dl.super-one.dev/{alpha,beta,stable}/latest/<installer>` download links. It reads the version's manifest from its **GitHub Release** (so any historical version works without a rebuild), and `force=true` overrides the semver guard to **roll a channel back** to an older version. Does **not** publish harness runtimes.

Tags are created by GitHub at publish time, never pushed from local. A failing build or bad artifact can be re-run without burning a version number or force-pushing a tag.

**Channel** is auto-derived by electron-builder from the version string: `-alpha.N` → channel `alpha` (yml files `alpha-mac.yml` / `alpha.yml` / `alpha-linux.yml`); `-beta.N` → `beta`; `-rc.N` → `rc`; otherwise → `latest`. Each channel's "current pointer" yml at the R2 root is written by **`set-latest`** (not promote), with cascade; binaries under `v${VERSION}/` are append-only (and set-latest backfills them from the GitHub Release if R2 has dropped them).

**npm dist-tag** for `@super-one/cli` mirrors the same pre-release rule: `-alpha*` → tag `alpha`, `-beta*` → `beta`, else `latest`. Pre-releases must **never** publish with dist-tag `latest`.

## Arguments

- **channel**: `alpha` (default). `beta` and `public` are reserved.
- **bump**: `patch` (default). `major` / `feature` / `patch` drive semver position:
  - `major`: `0.14.3-alpha` → `1.0.0-alpha`
  - `feature`: `0.14.3-alpha` → `0.15.0-alpha`
  - `patch`: `0.14.3-alpha` → `0.14.4-alpha`

## Workflow

**Network approval note**: every `gh workflow run`, `gh run view`, `gh release ...`, verification
`curl`, and `npm view` in this skill talks to `api.github.com`, `dl.super-one.dev`, or
`registry.npmjs.org`. Use the current agent environment's approved network/escalation mechanism from
the start instead of waiting for a sandbox-denial error. This applies to every network-touching
command below (Steps 3–9 and the Recovery Patterns).

### Step 1: Confirm version + CHANGELOG + relay / harness decisions (single turn)

This is the **only** human checkpoint in the pipeline. Do all of the following **in one response** and ask for a single combined confirmation:

1. Read `version` from `package.json`.
2. Parse args; default to `alpha` + `patch`. Reject `beta` / `public` (not yet supported) and stop.
3. Calculate the new version string.
4. `git log --oneline --no-decorate v<previous-version>..HEAD` to enumerate commits since the last release tag.
5. **Decide whether relay deploys this release**: run `git diff --quiet v<previous-version>..HEAD -- apps/relay/`. Non-empty diff → relay will be deployed and `apps/relay/package.json` will jump to the new version (skipping any intermediate versions where it wasn't deployed). Empty diff → relay is left alone.
6. **Decide whether harness R2 publish runs this release**:
   ```bash
   git diff --quiet v<previous-version>..HEAD -- \
     packages/runtime/src/harness/managed-official.ts \
     packages/runtime/src/harness/cdn.ts \
     scripts/publish-harness-artifacts.ts \
     .github/workflows/publish-harness.yml
   ```
   Non-empty → **yes** (pin constants, pack script, or workflow changed). Empty → **no** (existing R2 mirrors + channel manifest stay valid; desktop still has npm fallback).
   - Map the **app release channel** to the harness manifest channel: `alpha` → `alpha`, `beta` → `beta`, `public`/stable → `stable`.
   - **Manual override**: if the user asks to refresh harness mirrors even without a pin diff (e.g. first bootstrap, corrupted R2 object), treat harness publish as **yes** for this release and note it in the confirmation block.
7. Draft the CHANGELOG entry:
   - Drop noise (`chore(release): bump version`, purely internal refactors with no user impact).
   - Group by type — **Added** (feat), **Fixed** (fix), **Changed** (refactor affecting user behavior, dep upgrades with user impact), **Performance** (perf), **Tests** (test), **CI** (ci). Omit empty groups.
   - Concise, human-readable bullets. Combine related commits. No unverified claims ("may fix X") — only statements you can defend.
8. Show the user **all** of this in one plain markdown message — no tool call, just text in your reply:
   - `Current: X.Y.Z-alpha → New: A.B.C-alpha`
   - `Relay deploy: yes (apps/relay/package.json: <previous-relay-version> → <new-version>)` **or** `Relay deploy: no (no apps/relay/ diff since v<previous-version>)`
   - `CLI npm: yes (@super-one/cli@A.B.C-alpha, dist-tag alpha)` — default for every release (required for SSH registry install). Only note skip if the user explicitly asks for a desktop-only release.
   - `Harness R2: yes (channel=<alpha|beta|stable>, pins/script changed since v<previous>)` **or** `Harness R2: no (no managed pin / pack-script diff since v<previous>)` — when yes, note that Claude/Codex tarball mirrors + `harness/manifest/<channel>.json` will be rewritten on R2 (~1.2 GB pack, ~1–3 min CI).
   - The full drafted CHANGELOG entry (as the literal block that will be inserted)
9. Ask for one combined confirmation / edits, as a plain-language question at the end of the same
   message (e.g. "Proceed with this?"). Do not use a structured choice-card input tool for this step:
   the CHANGELOG draft is multi-line formatted content that option cards are not built to review. A
   normal markdown reply lets the user read and edit it inline.

After this confirmation, **everything below runs without further prompting** unless an actual error occurs. Do not ask the user to confirm before push, before build, before promote, or before publish.

### Step 2: Bump version, write CHANGELOG, commit, push

1. Insert `## [<new-version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`, right after the header block, with the confirmed entry.
2. Update `version` in **both** `package.json` (root) and `apps/desktop/package.json` to the new value — these always lockstep. **`publish-cli` packs using the root `package.json` version** (or the explicit `-f version=` input); do **not** change workspace `apps/cli/package.json` (`@superone/cli` stays private `0.0.0` — the public name is `@super-one/cli` from `pack-npm`).
3. **If Step 1 decided relay deploys this release**: also update `apps/relay/package.json` `version` to the same new value. The relay version skips intermediate releases where it had no diff, so this jump may be larger than a single semver step (e.g. `0.29.1-alpha` → `0.35.0-alpha`). That's intentional — it preserves the invariant that `apps/relay/package.json` reflects the version actually deployed to Cloudflare.
4. Do NOT modify `bun.lock` (version bumps don't touch deps).
5. Stage and commit in one shot:
   ```bash
   # Always:
   git add package.json apps/desktop/package.json CHANGELOG.md
   # Conditionally (relay deploy yes):
   git add apps/relay/package.json
   git commit -m "chore(release): bump version to <new-version>"
   ```
6. **Do NOT create a local git tag**. Tag creation is deferred to GitHub at publish time.
7. `git push origin main` (no `--tags`). No confirmation needed — already covered by Step 1.

### Step 3: Trigger per-platform builds + CLI publish (+ harness / relay if Step 1 said yes)

Always fire the three platform builds **and** `publish-cli.yml` (unless Step 1 marked CLI skip). **If Step 1 decided harness R2 publish**, also fire `publish-harness.yml`. **If Step 1 decided relay deploys this release** (i.e. you bumped `apps/relay/package.json` in Step 2), also fire `deploy-relay.yml`. All dispatches checkout the same `main` HEAD that contains the just-pushed release commit.

Derive the npm dist-tag from `<new-version>`:

| Version pattern | `-f tag=` |
|-----------------|-----------|
| `*-alpha*` / `*-alpha.*` | `alpha` |
| `*-beta*` / `*-beta.*` | `beta` |
| otherwise (stable) | `latest` |

Map harness manifest channel from the **release channel** (not from the npm dist-tag name `latest`):

| Release arg / version | `-f channel=` for `publish-harness` |
|-----------------------|-------------------------------------|
| `alpha` / `*-alpha*`  | `alpha` |
| `beta` / `*-beta*`    | `beta` |
| `public` / no pre     | `stable` |

```bash
gh workflow run build-mac.yml    --ref main
gh workflow run build-win.yml    --ref main
gh workflow run build-linux.yml  --ref main

# Lockstep CLI (default — skip only if Step 1 said desktop-only):
gh workflow run publish-cli.yml --ref main \
  -f version=<new-version> \
  -f tag=<alpha|beta|latest> \
  -f dry_run=false

# Only if Step 1 said harness R2 publish:
gh workflow run publish-harness.yml --ref main \
  -f channel=<alpha|beta|stable> \
  -f dry_run=false

# Only if Step 1 said relay deploys this release:
gh workflow run deploy-relay.yml --ref main \
  -f message="v<new-version> (commit $(git rev-parse --short HEAD))"
```

Do NOT re-run the relay or harness diff checks here — carry the booleans from Step 1. Step 2's release commit only touches version/CHANGELOG (and maybe relay package.json); it does **not** change harness pins, so a post-bump `git diff` for harness paths would still match Step 1.

Record each dispatched run's URL / ID.

- Each build checks out the requested ref (`main` by default), runs `bun run build:<os> -- --publish never` → electron-builder produces `dist/` but uploads nowhere → `actions/upload-artifact@v4` → artifacts `dist-mac` / `dist-win` / `dist-linux` attached to the run (30-day retention).
- `publish-cli.yml` checks out the same ref, runs CLI unit tests, `pack:npm` (esbuild bundle → `apps/cli/dist/npm`), smoke-installs natives, then `npm publish` with the pinned version + dist-tag. Prefer **Trusted Publishing (OIDC)** (`id-token: write`); workflow upgrades to npm ≥11.5.1 on the runner before publish (Node 22's bundled npm 10 signs provenance then fails PUT with a misleading E404). Optional `NPM_TOKEN` is used only when the secret is non-empty.
- `publish-harness.yml` checks out the same ref, reads pin constants from `packages/runtime/src/harness/managed-official.ts` (never free-form version inputs), `npm pack`s each platform tarball, writes `harness/manifest/<channel>.json`, and `aws s3 sync`s to `super-one-releases` (same R2 creds as promote). `dry_run=true` stages only (used for CI smoke); releases always pass `dry_run=false`. Pack is ~12 tarballs / ~1.2 GB compressed; typical wall time ~1–3 min on `ubuntu-latest`.
- `deploy-relay.yml` checks out the same ref, runs `bunx wrangler deploy --message "<message>"` against `apps/relay/`, authenticated via the `CLOUDFLARE_API_TOKEN` repo secret. The `--message` value shows up in the Cloudflare dashboard's Version History so you can map version IDs back to git commits.
- **Diff scope used in Step 1**: `apps/relay/` is a self-contained Cloudflare Worker — its source does not import from `packages/shared` or any other workspace, so changes elsewhere in the monorepo never require a relay redeploy. If you later add such an import, expand the Step 1 diff path accordingly.
- **Manual override**: to force a relay deploy even when no source diff exists (e.g. after a rollback at the Cloudflare layer), do it outside this skill via `gh workflow run deploy-relay.yml ...` directly. Do not bump `apps/relay/package.json` for it — that field is reserved for "version actually deployed during a release", not for ad-hoc redeploys. Same for harness: force with `gh workflow run publish-harness.yml --ref main -f channel=alpha -f dry_run=false` without a pin bump when R2 needs a refresh.

### Step 4: Monitor builds + CLI publish (+ harness / relay if dispatched)

Poll `gh run view <id> --json status,conclusion` for each dispatched run. Typical durations:

- **macOS build**: longest (~15 min, signing + notarization)
- **Linux / Windows builds**: 3-6 min
- **CLI publish** (`publish-cli.yml`): ~2–4 min (tests + pack + npm install smoke + publish)
- **Harness R2** (`publish-harness.yml`, if dispatched): ~1–3 min (npm pack all platforms + s3 sync)
- **Relay deploy** (if dispatched): 2-3 min (small Worker, no native deps)

**CLI verification** (once `publish-cli` is green):

```bash
npm view @super-one/cli@<new-version> version
npm view @super-one/cli dist-tags --json
# expect version listed and dist-tags.<alpha|beta|latest> == <new-version> for this channel
```

**Harness verification** (once `publish-harness` is green — only if dispatched):

```bash
# Manifest reachable and parseable (HEAD first; then a small GET of the JSON)
curl -sI "https://dl.super-one.dev/harness/manifest/<channel>.json" | head -1   # expect HTTP/.. 200
curl -s "https://dl.super-one.dev/harness/manifest/<channel>.json" | head -c 500
# Expect managedHarnesses.claude / .codex with artifacts[].url + digestSha256
# Optional: one artifact HEAD (pick a url from the manifest)
# curl -sI "<artifact-url>" | head -1
```

If any run fails:

- Inspect `gh run view <id> --log-failed | tail -40` to identify the root cause.
- Fix on `main`, push, and re-trigger ONLY that workflow. The successful run IDs from the other runs remain valid — `promote.yml` will pull each platform's artifact from its own run ID, and a re-deployed relay just supersedes the prior Cloudflare Version. CLI re-publish is safe only if the version was **never** successfully published (npm versions are immutable). Harness re-publish is always safe (R2 keys are content-addressed by pin version; overwrite is idempotent).
- Do NOT proceed to promote until all three **builds** are green (CLI publish, harness publish, and relay deploy can complete in any order relative to promote — promote does not depend on them — but **do not report the release complete** until CLI is green unless Step 1 skipped it, and until harness is green if Step 1 required it).

### Step 5: Trigger promote

Once all three builds are green, collect the run IDs and fire promote:

```bash
gh workflow run promote.yml --ref main \
  -f release_tag=v<new-version> \
  -f target_sha=$(git rev-parse origin/main) \
  -f mac_run_id=<mac-run-id> \
  -f win_run_id=<win-run-id> \
  -f linux_run_id=<linux-run-id>
```

- `release_tag` is the tag name (e.g. `v0.21.5-alpha`) — must NOT already exist as a real git tag; the promote step creates the draft release; publish step later materializes the tag at `target_sha`.
- `target_sha` is the commit the tag will point to when published. Default: current `origin/main`.
- All three `*_run_id` are optional individually, but at least one is required. Partial promotes are supported for iterative recovery.

Promote is **archive-only**. It downloads each platform's artifact, uploads them **flat** (binaries + channel ymls) to the draft GitHub Release (creating it with `--draft --prerelease`, or `--clobber`ing an existing one), then moves the binaries into a `v<version>/` subdir and `aws s3 sync`s **only the binaries** to R2 — the channel ymls are dropped (`rm staging/*.yml`). Idempotent — safe to re-run. **Promote does not make the version "latest" for anyone** — no root channel yml is written and no fixed links are created; that is Step 8 (set-latest).

### Step 6: Monitor promote + verify draft + verify R2 binaries

1. Poll `gh run view <promote-run-id>` until complete.
2. **GitHub Release assertion**: `gh release view v<new-version> --json isDraft,isPrerelease,assets -q '.isDraft, .isPrerelease, (.assets | length), (.assets[].name)'` — expect `isDraft=true`, `isPrerelease=true` (alpha/beta/rc), and the channel-prefixed yml files in the asset list (the GitHub Release keeps the **flat** ymls — both for bridge-mode legacy clients and as the manifest source for set-latest). Channel is derived from the new version: `<channel>-mac.yml` / `<channel>.yml` / `<channel>-linux.yml` where channel is `alpha` / `beta` / `rc` / `latest`. Full mac+win+linux is typically ~14 assets: 4 dmg/zip + 4 blockmap + 1 exe + 1 exe blockmap + 1 AppImage + 3 channel yml.
3. **R2 binaries assertion**: confirm the binaries landed under `v<version>/` (HEAD, don't download the body):
   ```bash
   curl -sI "https://dl.super-one.dev/v<new-version>/SuperOne-<new-version>.dmg" | head -1   # expect HTTP/.. 200
   ```
   **Do NOT** expect `<channel>-mac.yml` at the R2 root to reflect this version yet — promote no longer writes it; that happens in Step 8 (set-latest).
4. If both assertions pass, proceed to publish without prompting. If they fail, stop and surface the mismatch.

### Step 7: Publish

Extract the changelog entry for this version from `CHANGELOG.md` (everything between the `## [<new-version>]` heading and the next `##` heading). Use a HEREDOC so formatting is preserved:

```bash
NOTES=$(awk '/^## \[<new-version>\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
gh release edit v<new-version> --draft=false --prerelease --notes "$NOTES"
```

**Alpha/beta/rc tags MUST use `--prerelease`** at publish time. With R2 + GenericProvider, this flag no longer affects auto-update (channel is determined by the yml filename on R2, which electron-builder derives from the version string), but it still controls GitHub Release UI classification and keeps the GitHub Releases list consistent with the bundled CHANGELOG. promote.yml already auto-derives the same flag for the draft creation step, so this is the only manual moment where you confirm it.

For `public` (future, version like `1.0.0` without semver prerelease suffix): omit `--prerelease`.

Publishing materializes the tag on `target_commitish` (the SHA supplied to promote). Run `git fetch origin --tags` afterwards so the local repo has the new tag.

### Step 8: Set channel latest + fixed download links (set-latest)

After publish, run `set-latest.yml` to establish this version as the channel's latest **with cascade** and to (re)generate the permanent `{channel}/latest/` download links. This is also the **rollback** tool.

```bash
gh workflow run set-latest.yml --ref main \
  -f release_tag=v<new-version> \
  -f channel=<alpha|beta|stable>
```

- `channel` is the **user-facing** channel name (`stable` maps to the `latest-*.yml` track on R2). Cascade is automatic — `stable` updates `latest`+`beta`+`alpha`, `beta` updates `beta`+`alpha`, `alpha` only `alpha`. A semver guard skips any channel whose live version is already newer (so an older stable never downgrades alpha users).
- Manifest source is the version's **GitHub Release** (`gh release download <tag>`), so the release must exist (it does — promote created it). If the version's binaries are **not** on R2 under `v<version>/` (e.g. rolling back to an old or pruned version — R2 is not guaranteed to retain every version forever), set-latest **backfills** them from the GitHub Release to R2 before re-pointing the channel. So rollback works for any historical version that still has a GitHub Release, even if R2 dropped its binaries.
- Monitor: `gh run view <id> --json status,conclusion`. Then verify the fixed links resolve — use **HEAD**, never download the full body:
  ```bash
  curl -sI https://dl.super-one.dev/<channel>/latest/SuperOne.dmg | head -1   # expect HTTP/.. 200
  ```
  (Windows installer name contains a space → URL-encode: `SuperOne%20Setup.exe`.)
- **Rollback**: to re-point a channel at an older version, override the semver guard with `force=true`:
  ```bash
  gh workflow run set-latest.yml --ref main \
    -f release_tag=v<older-version> -f channel=alpha -f force=true
  ```

### Step 9: Report

Show the user:

1. The final GitHub Release URL and the tag SHA (`git fetch origin --tags` so local is in sync).
2. Whether relay was deployed this release.
3. **CLI npm status**: `@super-one/cli@<new-version>` published (or skipped), dist-tag used, and `npm view` confirmation. Mention that desktop remote install pins this exact version (`npm i -g @super-one/cli@<new-version>` / registry path over SSH).
4. **Harness R2 status**: published (channel + run URL + `https://dl.super-one.dev/harness/manifest/<channel>.json`) **or** skipped (no pin/script diff). Remind that desktop install is R2-primary / npm-fallback either way.

## Recovery Patterns

| Failure | Action |
|---|---|
| Build workflow fails on one platform | Fix on main, re-trigger that platform only, reuse the other two platforms' existing run IDs in promote |
| `publish-cli.yml` fails tests / pack / smoke | Fix on main, re-trigger `publish-cli.yml` with the **same** `-f version=<new-version>`. Desktop promote can continue in parallel — remote registry install for this version stays broken until CLI is green |
| `publish-cli.yml` fails with `ENEEDAUTH` / blank auth | Prefer npm Trusted Publishing: package `@super-one/cli` on npmjs.com must list this GitHub repo + workflow filename `publish-cli.yml`, and the job must keep `permissions.id-token: write`. Do **not** export an empty `NPM_TOKEN` (blank `_authToken` in `.npmrc` breaks OIDC). Optional: set a real Automation `NPM_TOKEN` secret |
| `publish-cli.yml` fails with `E404` after provenance signed | Usually outdated npm CLI on the runner (need ≥11.5.1). Workflow must run `npm install -g npm@^11.5.1` before publish; restore that step if removed. Also confirm Trusted Publisher config matches repo/workflow name exactly |
| `publish-cli.yml` fails because version already exists on npm | Versions are immutable — do **not** try to overwrite. Ship a new patch version (re-run full release bump) instead |
| `publish-harness.yml` fails on `npm pack` | Usually registry/network blip or a pin that 404s (wrong platform version for Codex). Confirm `OFFICIAL_CLAUDE_SDK_VERSION` / `OFFICIAL_CODEX_NPM_VERSION` resolve on npm for every platform suffix the script packs. Fix pins on main if needed, re-trigger with the same `-f channel=`. Desktop can still install via npm fallback while R2 is stale |
| `publish-harness.yml` fails on R2 sync | Same R2 secrets as promote (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`). Do **not** use `aws-actions/configure-aws-credentials` (STS NXDOMAIN on R2). Re-trigger is safe — `aws s3 sync` overwrites the same keys. Builds/promote are independent |
| `publish-harness.yml` not listed / 404 on dispatch | Workflow file must exist on the **default branch** for `workflow_dispatch`. Ensure `.github/workflows/publish-harness.yml` is on `main` (registration PR) even when the pack script lands via a later merge |
| Need harness refresh without a release | Outside this skill: `gh workflow run publish-harness.yml --ref main -f channel=alpha -f dry_run=false` (or `dry_run=true` for pack-only smoke) |
| `deploy-relay.yml` fails | Inspect `gh run view <id> --log-failed`. Most common cause: `CLOUDFLARE_API_TOKEN` repo secret missing, expired, or scoped wrong (needs `Account: Workers Scripts:Edit` + `Account:Read`). Fix the secret in repo Settings → Secrets, then re-run the workflow — wrangler deploys are idempotent so the new run just supersedes the prior partial state. Build/promote/publish are independent and can proceed regardless |
| Promote workflow fails mid-upload (GitHub side) | Re-trigger promote with the same tag — `--clobber` replaces any partial assets |
| Promote workflow fails on R2 sync step | The GitHub Release upload happens before the R2 sync step in promote.yml, so the GitHub side can be intact while R2 is empty. Re-trigger promote with the same tag — `aws s3 sync` is idempotent (same key = update); the GitHub upload step uses `--clobber` |
| Promote fails with `getaddrinfo ENOTFOUND sts.<region>.amazonaws.com` | Do **NOT** use `aws-actions/configure-aws-credentials@v4` for R2 — its default STS credential validation tries to call AWS STS, which doesn't apply to Cloudflare R2 (region `auto` produces `sts.auto.amazonaws.com` NXDOMAIN). promote.yml injects R2 creds as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` env vars directly on the sync step, no action wrapper. If you see this error, someone re-introduced the action — remove it |
| R2 channel yml has stale paths (no `v${VERSION}/` prefix) | The prefix is applied by `prefixVersionPaths` (`scripts/lib/channels.ts`) inside **set-latest**, not promote — promote no longer touches root ymls. If the live `<channel>-mac.yml` lacks the `v<version>/` prefix, re-run `set-latest` for that tag/channel |
| Draft release has wrong tag or SHA | `gh release delete v<new-version> --cleanup-tag --yes`, then re-run promote |
| `set-latest` fails with `GetObjectTagging not implemented` | Cloudflare R2 does not implement object tagging, which `aws s3 cp` calls during an s3→s3 server-side copy. The fixed-link copy step passes `--copy-props none` to skip tag/metadata propagation. If you hit this, someone removed that flag — restore it. (The earlier `aws s3 cp out/ --recursive` for the ymls is a local→s3 upload and is unaffected) |
| `set-latest` staged nothing (semver guard held) | The target version is older than the channel's live version, so the guard skipped it (workflow logs `hold <yml>: live X is newer`). Intended — to **roll back** to that older version, re-run with `force=true` |
| Already published and later found broken | Either ship a new patch version, or **roll the channel back** with `set-latest force=true` pointed at the last-good tag (re-points the channel yml + fixed links to the good version without rewriting history). Broken **CLI** on npm cannot be un-published in place — ship a new lockstep patch and republish `@super-one/cli` |

## Invariants

- Local git never creates or force-pushes tags for releases. GitHub owns tag creation at publish time.
- `CHANGELOG.md` entries describe only **verified** behavior — no "may fix" or speculative claims.
- Alpha/beta/rc releases are always marked `isPrerelease=true` in GitHub for UI classification consistency. (R2 + GenericProvider auto-update no longer depends on this flag — it's driven by the channel-suffixed yml filename.)
- `bun.lock` is never modified by the release flow.
- **Dual-publish is permanent**: `promote.yml` always uploads to both GitHub Release (flat layout) and R2 (`v${VERSION}/` subdirectory). GitHub Release is the legacy path for clients built before the R2 switch, R2 is the source of truth for current/future clients. **Never** delete the GitHub Release upload step.
- **`set-latest` is decoupled from `promote`** and is never auto-invoked by it — running set-latest is a separate, explicit step. promote archives the build; set-latest makes a version a channel's latest (cascade) + refreshes the fixed `{channel}/latest/` download links + is the rollback path (`force=true`). Channel logic (cascade, semver compare, path prefix, version-less naming) lives in `scripts/lib/channels.ts` — **CI-only, kept out of the app bundle**; `@superone/shared/update-channels` exposes only the app-facing surface (`UPDATE_CHANNELS` / `UPDATE_CHANNEL_TO_YML` / `channelFromVersion`). set-latest reads each version's manifest from its **GitHub Release**, and **backfills the binaries to R2 from that Release if `v<version>/` is missing** (R2 is not guaranteed to keep every version), so it works for any historical version without a rebuild.
- **Never rotate `UPDATER_TOKEN`** the GitHub PAT secret. Legacy alpha clients embed it in their ASAR for `PrivateGitHubProvider` auth; rotating the token bricks their auto-update path. The secret is no longer consumed by any build workflow but **must** remain valid in GitHub Secrets indefinitely.
- **Relay deploys go through `deploy-relay.yml`, never local terminal.** The `CLOUDFLARE_API_TOKEN` lives only in GitHub repo secrets. Local `bun run deploy:relay` will fail in non-interactive shells, and skill permissions deliberately block credential discovery from shell rc files. Always dispatch the workflow.
- **Relay deploy is conditional on actual diff.** Only dispatch `deploy-relay.yml` when `git diff v<previous>..HEAD -- apps/relay/` is non-empty. No-op deploys just clutter Cloudflare's Version History with duplicate Version IDs and obscure the real protocol-changing deploys you'd want to roll back to.
- **`apps/relay/package.json` version skips intermediate releases.** It is bumped only on releases where relay actually deploys, and it jumps straight to the current release version. So the relay version may go `0.29.1-alpha → 0.35.0-alpha` if the six intermediate releases between them had no `apps/relay/` diff. This is what keeps `apps/relay/package.json` truthful: its version always matches the version actually running on Cloudflare for this commit lineage. **Never** lockstep-bump it just because the root or desktop version moved.
- **`@super-one/cli` locksteps with root/desktop version.** Every release dispatches `publish-cli.yml` with `-f version=<new-version>` (same string as `package.json` / app). Never publish pre-releases with npm dist-tag `latest`. Never install bare `@latest` / `@alpha` from desktop remote install — always pin the exact version. Workspace package `@superone/cli` stays private `0.0.0`; public package name is `@super-one/cli` produced by `apps/cli/scripts/pack-npm.ts`.
- **Harness R2 mirrors do not lockstep with every app version.** Dispatch `publish-harness.yml` only when `OFFICIAL_CLAUDE_SDK_VERSION` / `OFFICIAL_CODEX_NPM_VERSION` (or the pack/CDN script/workflow) changed since the previous tag — or when the user explicitly forces a refresh. Pins are read from source constants inside the workflow; **never** pass free-form package versions as workflow inputs (channel + dry_run only). Artifact keys are content-addressed by npm name + version (`harness/artifacts/...`), so re-publish of the same pin is idempotent. Channel manifests live at `harness/manifest/<alpha|beta|stable>.json` and are independent of app auto-update ymls (`alpha-mac.yml` etc.). Desktop install is **R2 primary, npm registry fallback**, one SHA-256 for both. Promote / set-latest **never** write under `harness/`.

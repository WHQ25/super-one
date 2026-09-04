---
name: release
description: "Automate the SuperOne release process: version bump, commit, per-platform build, CLI npm publish, harness R2 mirror (when pins change), promote artifacts to draft release, and publish. Trigger with /release [alpha|stable] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
arguments: "[alpha|stable] [major|feature|patch]"
argument-hint: "[alpha|stable] [major|feature|patch]"
compatibility: "Requires git, gh, bun, npm, curl, GitHub Actions access, and network approval for GitHub, npm, and dl.super-one.dev."
---

# Release Skill

Automate the SuperOne release pipeline. The pipeline has **independently retryable** phases — build, **CLI npm publish**, **harness R2 publish** (conditional), relay deploy, promote, publish, set-latest — orchestrated via GitHub Actions workflow_dispatch:

- `build-mac.yml` / `build-win.yml` / `build-linux.yml` — each builds one platform, uploads artifacts to Actions storage (30-day retention). No release side effects.
- `publish-cli.yml` — packs and publishes **`@super-one/cli`** to the public npm registry at the **same version string** as desktop (lockstep). Desktop **Other Devices → SSH → registry install** pins `@super-one/cli@<app-version>`; if this step is skipped, remote SSH bootstrap cannot install that version from npm. Auth: npm **Trusted Publishing (OIDC)** for this repo (preferred) or optional `NPM_TOKEN` secret. Independent of desktop electron-builder — fires in parallel with builds at Step 3.
- `publish-harness.yml` — **conditional**. When Claude/Codex managed pin constants (or the pack script) changed since the previous tag, `npm pack`s the pinned platform tarballs, SHA-256s them, and `aws s3 sync`s byte-exact mirrors + `harness/manifest/<channel>.json` to R2 (`https://dl.super-one.dev/harness/...`). Desktop install tries R2 first, npm registry fallback, same digest. Auth: same R2 secrets as promote (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID`). Independent of electron-builder — fires in parallel with builds at Step 3 when Step 1 said yes. **Not every app release** — only when harness pins move (see Invariants).
- `deploy-relay.yml` — runs `bunx wrangler deploy` against `apps/relay/` to push the Cloudflare Worker (relay) to production. Authenticated by the repo `CLOUDFLARE_API_TOKEN` secret, so this **must** run inside Actions, never from a local terminal (the local shell typically lacks the token, and skill permissions block credential-discovery anyway). Independent of the build/promote chain — triggered in parallel with builds at Step 3.
- `promote.yml` — **archive only**. Takes a `variant` and downloads artifacts, then (a) uploads them **flat** (binaries + update ymls) to a **draft** GitHub Release (bridge-mode legacy path — legacy alpha clients embed `UPDATER_TOKEN` and pull from there — **and** the manifest source for set-latest); (b) moves the binaries into a `<variant>/v${VERSION}/` subdir and `aws s3 sync`s **only the binaries** to Cloudflare R2 bucket `super-one-releases` served at `https://dl.super-one.dev`. It writes **no** pointer yml — a promoted version is archived but not yet anyone's latest (that's `set-latest`). Promote does **not** touch `harness/` keys (those are `publish-harness` only).
- `prune-releases.yml` — **manual, destructive, dry-run by default**. Deletes a variant's archived binaries under `<variant>/v<version>/`, either one version or everything below a boundary. It refuses to touch a version any of that variant's `latest-*.yml` still points at, and it fails rather than proceeding if it cannot read those pointers. Optionally deletes the GitHub Release too — see the invariant below before using that.
- Final `gh release edit --draft=false --prerelease` — flips the draft to published; GitHub then materializes the tag on `target_commitish`.
- `set-latest.yml` — **manual, decoupled from promote**. Sets a given release as one variant's latest: writes `<variant>/latest-*.yml` on R2 and refreshes the permanent `https://dl.super-one.dev/{alpha,stable}/latest/<installer>` download links. **There is no cascade** — stable and alpha are separate apps with separate `appId`s, so handing the alpha app a stable installer would install a different bundle over it. It reads the version's manifest from its **GitHub Release** (so any historical version works without a rebuild), and `force=true` overrides the semver guard to **roll a variant back** to an older version. Does **not** publish harness runtimes.

Tags are created by GitHub at publish time, never pushed from local. A failing build or bad artifact can be re-run without burning a version number or force-pushing a tag.

**Variant, not channel.** SuperOne ships as two side-by-side apps built from one codebase — `stable` and `alpha` — with different `appId`, `productName`, package.json `name`, userData directory and Computer Use helper identity, all declared in `apps/desktop/variants.json`. They install alongside each other and never share data.

Every build therefore needs `SUPERONE_VARIANT`; `electron-builder.config.cjs` has **no default** and fails without it. It also asserts the version's prerelease tag matches the variant (`stable` ⇒ no prerelease, `alpha` ⇒ `-alpha`), because `@super-one/cli`, the harness manifest channel and the GitHub prerelease flag are all still derived from the version string.

Each variant sets `publish.channel: latest` explicitly, so electron-builder emits the same `latest-mac.yml` / `latest.yml` / `latest-linux.yml` for both and the **variant lives in the R2 prefix**:

```
dl.super-one.dev/
  stable/  latest-mac.yml  v0.63.0/…        latest/<installer>
  alpha/   latest-mac.yml  v0.64.0-alpha/…  latest/<installer>
```

Pointer ymls are written by **`set-latest`** (not promote); binaries under `<variant>/v${VERSION}/` are append-only (and set-latest backfills them from the GitHub Release if R2 has dropped them).

**npm dist-tag** for `@super-one/cli` follows the variant: `-alpha*` → tag `alpha`, otherwise `latest`. Pre-releases must **never** publish with dist-tag `latest`, and the workflow refuses any pre-release it cannot map (including a stray `-beta` / `-rc`) rather than silently tagging it `latest`.

## Arguments

- **variant**: `alpha` (default) or `stable`. This is which app is being released, not a channel of one app.
- **bump**: `patch` (default). `major` / `feature` / `patch` drive semver position:
  - `major`: `0.14.3-alpha` → `1.0.0-alpha`
  - `feature`: `0.14.3-alpha` → `0.15.0-alpha`
  - `patch`: `0.14.3-alpha` → `0.14.4-alpha`

## CHANGELOG structure

`CHANGELOG.md` has one canonical timeline — **the stable line**. Alpha is not a
second product; it is the channel SuperOne uses to prove a stable candidate, so
its entries are working notes, not the record.

```markdown
## [Unreleased]          ← the stable candidate. Grows with every alpha.
## [0.61.1-alpha]        ← per-release increment. Deleted when the stable ships.
## [0.61.0]              ← a shipped stable. Permanent.
```

Three consequences worth stating, because each one is a trap:

- **`[Unreleased]` is maintained by every alpha release, not written at stable
  cut time.** A stable build is packaged from an already-proven *alpha commit*,
  so if its notes needed a commit, that commit would either be absent from the
  build or make it "the validated tree plus something nobody ran". Keeping the
  candidate current in each alpha's bump commit means every alpha commit already
  carries the notes it would ship as. **Cutting a stable touches no file.**
- **Alpha entries are deleted once the stable covering them ships**, folded down
  into that stable's entry. Their full text survives on each alpha's own GitHub
  Release, which the invariants already forbid deleting. The fold-down is not
  done at cut time either — it rides along in the next alpha's bump commit
  (Step 2, item 2).
- **`[Unreleased]` is not a copy of the alpha entries.** It is the same changes
  rewritten for someone who upgraded stable-to-stable and saw no alpha: iteration
  folded into final shape, alpha-only regressions dropped, Tests/CI omitted.

## Workflow

**Network approval note**: every `gh workflow run`, `gh run view`, `gh release ...`, verification
`curl`, and `npm view` in this skill talks to `api.github.com`, `dl.super-one.dev`, or
`registry.npmjs.org`. Use the current agent environment's approved network/escalation mechanism from
the start instead of waiting for a sandbox-denial error. This applies to every network-touching
command below (Steps 3–9 and the Recovery Patterns).

### Step 1: Confirm version + CHANGELOG + relay / harness decisions (single turn)

This is the **only** human checkpoint in the pipeline. Do all of the following **in one response** and ask for a single combined confirmation:

1. Read `version` from `package.json`.
2. Parse args; default to `alpha` + `patch`.
3. Calculate the new version string. For `alpha` it keeps the `-alpha` suffix. For `stable` see **Cutting a stable release** below — it is not a bump of the alpha line.
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
   - The harness manifest channel is the variant id: `alpha` → `alpha`, `stable` → `stable`.
   - **Manual override**: if the user asks to refresh harness mirrors even without a pin diff (e.g. first bootstrap, corrupted R2 object), treat harness publish as **yes** for this release and note it in the confirmation block.
7. Draft **two** CHANGELOG blocks — see **CHANGELOG structure** for why there are two:
   - The **alpha entry** (`## [<new-version>] - <date>`) — this release's increment:
     - Drop noise (`chore(release): bump version`, purely internal refactors with no user impact).
     - Group by type — **Added** (feat), **Fixed** (fix), **Changed** (refactor affecting user behavior, dep upgrades with user impact), **Performance** (perf), **Tests** (test), **CI** (ci). Omit empty groups.
     - Concise, human-readable bullets. Combine related commits. No unverified claims ("may fix X") — only statements you can defend.
   - The updated **`## [Unreleased]`** block — the stable candidate, re-stated in full after merging this release's changes into what is already there. Write it for someone upgrading the *stable* app, who saw none of the alphas in between:
     - Fold repeated iteration on one feature into its final shape. Three alphas refining the same panel is one bullet, not three.
     - Drop a fix whose bug only ever existed in an alpha — a stable user never met it.
     - Omit **Tests** and **CI**. Real work, but not a stable user's release notes.
8. Show the user **all** of this in one plain markdown message — no tool call, just text in your reply:
   - `Current: X.Y.Z-alpha → New: A.B.C-alpha`
   - `Relay deploy: yes (apps/relay/package.json: <previous-relay-version> → <new-version>)` **or** `Relay deploy: no (no apps/relay/ diff since v<previous-version>)`
   - `CLI npm: yes (@super-one/cli@A.B.C-alpha, dist-tag alpha)` — default for every release (required for SSH registry install). Only note skip if the user explicitly asks for a desktop-only release.
   - `Harness R2: yes (channel=<alpha|stable>, pins/script changed since v<previous>)` **or** `Harness R2: no (no managed pin / pack-script diff since v<previous>)` — when yes, note that Claude/Codex tarball mirrors + `harness/manifest/<channel>.json` will be rewritten on R2 (~1.2 GB pack, ~1–3 min CI).
   - The full drafted alpha entry (as the literal block that will be inserted)
   - The updated `## [Unreleased]` block, in full — it is the next stable release's notes verbatim, and this is the only moment anyone reviews it
9. Ask for one combined confirmation / edits, as a plain-language question at the end of the same
   message (e.g. "Proceed with this?"). Do not use a structured choice-card input tool for this step:
   the CHANGELOG draft is multi-line formatted content that option cards are not built to review. A
   normal markdown reply lets the user read and edit it inline.

After this confirmation, **everything below runs without further prompting** unless an actual error occurs. Do not ask the user to confirm before push, before build, before promote, or before publish.

### Step 2: Bump version, write CHANGELOG, commit, push

1. Rewrite the top of `CHANGELOG.md`, right after the header block, with the two confirmed blocks: `## [Unreleased]` first, then `## [<new-version>] - <YYYY-MM-DD>` below it. `[Unreleased]` is **replaced wholesale** by the merged version, never appended to.
2. **If a stable release was cut since the previous alpha**, do its pending fold-down in this same commit (this is the only place it happens — see **Cutting a stable release**): rename the then-current `## [Unreleased]` to `## [<stable-version>] - <that release's date>`, delete every `-alpha` entry it covers, and build the new `## [Unreleased]` above it from this release's changes alone.
3. Update `version` in **both** `package.json` (root) and `apps/desktop/package.json` to the new value — these always lockstep. It is the **base** version: a plain release number with **no** `-alpha` suffix. The alpha variant appends its own at package time, so one base of `0.61.0` yields `0.61.0-alpha` and `0.61.0`. A base carrying a prerelease tag fails the build. **`publish-cli` packs using the root `package.json` version verbatim** (or the explicit `-f version=` input) — it does NOT derive a variant suffix, so the alpha CLI publish needs `-f version=<X.Y.Z>-alpha -f tag=alpha` while the stable one can take the default; do **not** change workspace `apps/cli/package.json` (`@superone/cli` stays private `0.0.0` — the public name is `@super-one/cli` from `pack-npm`).
4. **If Step 1 decided relay deploys this release**: also update `apps/relay/package.json` `version` to the same new value. The relay version skips intermediate releases where it had no diff, so this jump may be larger than a single semver step (e.g. `0.29.1-alpha` → `0.35.0-alpha`). That's intentional — it preserves the invariant that `apps/relay/package.json` reflects the version actually deployed to Cloudflare.
5. Do NOT modify `bun.lock` (version bumps don't touch deps).
6. Stage and commit in one shot:
   ```bash
   # Always:
   git add package.json apps/desktop/package.json CHANGELOG.md
   # Conditionally (relay deploy yes):
   git add apps/relay/package.json
   git commit -m "chore(release): bump version to <new-version>"
   ```
7. **Do NOT create a local git tag**. Tag creation is deferred to GitHub at publish time.
8. `git push origin main` (no `--tags`). No confirmation needed — already covered by Step 1.

### Step 3: Trigger per-platform builds + CLI publish (+ harness / relay if Step 1 said yes)

Always fire the three platform builds **and** `publish-cli.yml` (unless Step 1 marked CLI skip). **If Step 1 decided harness R2 publish**, also fire `publish-harness.yml`. **If Step 1 decided relay deploys this release** (i.e. you bumped `apps/relay/package.json` in Step 2), also fire `deploy-relay.yml`. All dispatches checkout the same `main` HEAD that contains the just-pushed release commit.

Derive the npm dist-tag from `<new-version>`:

| Version pattern | `-f tag=` |
|-----------------|-----------|
| `*-alpha*` / `*-alpha.*` | `alpha` |
| otherwise (stable) | `latest` |

The harness manifest channel is the variant id (not the npm dist-tag name `latest`):

| Variant | `-f channel=` for `publish-harness` |
|---------|-------------------------------------|
| `alpha`  | `alpha` |
| `stable` | `stable` |

```bash
# `variant` is required — the builder config has no default on purpose, since a
# silent default ships a build under the wrong identity. Pass `version` only
# when packaging a commit under a different version (see "Cutting a stable
# release"); leave it blank otherwise.
for wf in build-mac build-win build-linux; do
  gh workflow run "$wf.yml" --ref main \
    -f variant=<alpha|stable> \
    -f version=<blank or the override>
done

# Lockstep CLI (default — skip only if Step 1 said desktop-only):
gh workflow run publish-cli.yml --ref main \
  -f version=<new-version> \
  -f tag=<alpha|latest> \
  -f dry_run=false

# Only if Step 1 said harness R2 publish:
gh workflow run publish-harness.yml --ref main \
  -f channel=<alpha|stable> \
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
# expect version listed and dist-tags.<alpha|latest> == <new-version> for this variant
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
  -f variant=<alpha|stable> \
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
2. **GitHub Release assertion**: `gh release view v<new-version> --json isDraft,isPrerelease,assets -q '.isDraft, .isPrerelease, (.assets | length), (.assets[].name)'` — expect `isDraft=true`, `isPrerelease=true` for an alpha release, and the update ymls in the asset list (the GitHub Release keeps the **flat** ymls — both for bridge-mode legacy clients and as the manifest source for set-latest). Both variants emit `latest-mac.yml` / `latest.yml` / `latest-linux.yml`, since the variant lives in the R2 prefix, not the file name. Full mac+win+linux is typically ~14 assets: 4 dmg/zip + 4 blockmap + 1 exe + 1 exe blockmap + 1 AppImage + 3 yml.
3. **R2 binaries assertion**: confirm the binaries landed under `<variant>/v<version>/` (HEAD, don't download the body):
   ```bash
   curl -sI "https://dl.super-one.dev/<variant>/v<new-version>/SuperOne-<new-version>.dmg" | head -1   # expect HTTP/.. 200
   ```
   The stable variant's installers are named `SuperOne-…`, alpha's `SuperOne Alpha-…` (productName differs per variant). **Do NOT** expect `<variant>/latest-mac.yml` to reflect this version yet — promote no longer writes it; that happens in Step 8 (set-latest).
4. If both assertions pass, proceed to publish without prompting. If they fail, stop and surface the mismatch.

### Step 7: Publish

Extract the notes from `CHANGELOG.md`. **Which heading depends on the variant**: an
alpha reads its own entry; a stable reads `[Unreleased]`, the accumulated candidate
this build was cut from.

```bash
# alpha
NOTES=$(awk '/^## \[<new-version>\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
gh release edit v<new-version> --draft=false --prerelease --notes "$NOTES"

# stable
NOTES=$(awk '/^## \[Unreleased\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
gh release edit v<new-version> --draft=false --notes "$NOTES"
```

A stable release has **no** `## [<version>]` heading in `CHANGELOG.md` when it
publishes — that heading is written later, by the next alpha's bump commit. Do not
"repair" the stable command to read `## [<new-version>]`: `\[0.62.0\]` does not match
`[0.62.0-alpha]`, so it extracts **zero lines** and publishes empty notes with nothing
failing. `v0.61.0` shipped carrying only its last alpha's increment for exactly this
reason.

**Alpha tags MUST use `--prerelease`** at publish time. With R2 + GenericProvider this flag does not affect auto-update (each variant reads its own prefix), but it controls GitHub Release UI classification and keeps the GitHub Releases list consistent with the bundled CHANGELOG. promote.yml auto-derives the same flag from the version for the draft creation step, so this is the only manual moment where you confirm it.

For a stable release (version like `1.0.0`, no prerelease suffix): omit `--prerelease`.

Publishing materializes the tag on `target_commitish` (the SHA supplied to promote). Run `git fetch origin --tags` afterwards so the local repo has the new tag.

### Step 8: Set variant latest + fixed download links (set-latest)

After publish, run `set-latest.yml` to establish this version as the variant's latest and to (re)generate the permanent `{variant}/latest/` download links. This is also the **rollback** tool.

```bash
gh workflow run set-latest.yml --ref main \
  -f release_tag=v<new-version> \
  -f variant=<alpha|stable>
```

- `variant` is the app being published. **Nothing cascades**: each variant has its own `<variant>/latest-*.yml` and its own installers, and an installer from the other variant carries a different `appId`. A semver guard skips the variant if its live version is already newer.
- Manifest source is the version's **GitHub Release** (`gh release download <tag>`), so the release must exist (it does — promote created it). If the version's binaries are **not** on R2 under `v<version>/` (e.g. rolling back to an old or pruned version — R2 is not guaranteed to retain every version forever), set-latest **backfills** them from the GitHub Release to R2 before re-pointing the channel. So rollback works for any historical version that still has a GitHub Release, even if R2 dropped its binaries.
- Monitor: `gh run view <id> --json status,conclusion`. Then verify the fixed links resolve — use **HEAD**, never download the full body:
  ```bash
  # stable: SuperOne-arm64.dmg   alpha: SuperOne-alpha-arm64.dmg
  curl -sI https://dl.super-one.dev/stable/latest/SuperOne-arm64.dmg | head -1  # expect HTTP/.. 200
  curl -sI https://dl.super-one.dev/alpha/latest/SuperOne-alpha-arm64.dmg | head -1
  ```
  Both variants build their installers from the base name `SuperOne`; the
  variant's `prereleaseTag` is the only thing separating the two fixed links
  (`SuperOne-Setup.exe` vs `SuperOne-alpha-Setup.exe`). No current name
  contains a space.
- **Rollback**: to re-point a channel at an older version, override the semver guard with `force=true`:
  ```bash
  gh workflow run set-latest.yml --ref main \
    -f release_tag=v<older-version> -f variant=alpha -f force=true
  ```
- **`legacy_root=true` — the one-way bridge for pre-variant clients.** Builds from
  before the variant split poll `alpha-*.yml` at the **bucket root**, not inside any
  variant prefix, so a normal `set-latest` reaches none of them. This flag re-roots
  the same manifest to `stable/v<version>/…` and writes it under those legacy root
  names, pulling installed clients onto the stable app. Use it on the **cutover
  stable release**, and keep using it on later stable releases until you are willing
  to strand whoever never updated. The script refuses it for any variant that is not
  `com.superone.app`, and skips root names that do not already exist.
  ```bash
  gh workflow run set-latest.yml --ref main \
    -f release_tag=v<version> -f variant=stable -f legacy_root=true
  ```
  Verify afterwards — the root manifest must name the version **and** the prefix:
  ```bash
  curl -s https://dl.super-one.dev/alpha-mac.yml | grep -E '^version:|^path:'
  # version: <version>
  # path: stable/v<version>/SuperOne-<version>-arm64-mac.zip
  ```

### Step 9: Report

Show the user:

1. The final GitHub Release URL and the tag SHA (`git fetch origin --tags` so local is in sync).
2. Whether relay was deployed this release.
3. **CLI npm status**: `@super-one/cli@<new-version>` published (or skipped), dist-tag used, and `npm view` confirmation. Mention that desktop remote install pins this exact version (`npm i -g @super-one/cli@<new-version>` / registry path over SSH).
4. **Harness R2 status**: published (channel + run URL + `https://dl.super-one.dev/harness/manifest/<channel>.json`) **or** skipped (no pin/script diff). Remind that desktop install is R2-primary / npm-fallback either way.

## Cutting a stable release

A stable release is **not** a bump of the alpha line. It is the same tree that
has been running as alpha, packaged under the stable identity:

1. Pick the alpha commit that has proven itself in the field. Use its SHA as
   `ref` for the builds — do **not** create a bump commit, or the stable binary
   is "the validated tree plus a commit nobody ran".
2. Dispatch the three builds with `-f variant=stable`. Add `-f version=<X.Y.Z>`
   **only** when cutting from a commit whose `package.json` base differs from the
   number you want to ship; the base already packages as `X.Y.Z` for stable and
   `X.Y.Z-alpha` for alpha, so the usual case needs no override. The value is the
   BASE — pass `0.61.0`, never `0.61.0-alpha`; a base with a prerelease tag fails
   the build. It reaches electron-builder before `AppInfo` is built, so it drives
   artifact filenames, `app.getVersion()` and the update manifest.
3. **Publish the stable harness channel.** The normal Step-1 diff rule almost
   never fires on a stable cut (no pin changed -- the tree is the alpha tree),
   so this is easy to skip, and `harness/manifest/stable.json` does not exist
   until someone runs it. Without it every stable client falls back to plain
   npm for harness downloads: not fatal, but slow and it bypasses R2 entirely.
   `app_version` is derived from the channel (base + that variant's prerelease
   tag), so it needs no override unless the commit's base differs from the
   number you are shipping.
   ```bash
   gh workflow run publish-harness.yml --ref <the same alpha SHA> -f channel=stable
   ```
   Verify: `curl -sI https://dl.super-one.dev/harness/manifest/stable.json | head -1`
   and `.../app/harness-pins/<X.Y.Z>.json`.
4. `publish-cli` for the same version with dist-tag `latest`, then promote and
   set-latest with `-f variant=stable`. For a stable release that must also collect
   pre-variant clients, add `-f legacy_root=true` (see Step 8).

The alpha line keeps moving independently; nothing about the stable cut changes
`package.json`, so the next alpha release continues from where it was.

**A stable cut writes no file at all** — not `package.json`, not `CHANGELOG.md`.
Its notes are the `## [Unreleased]` block already sitting in the commit being
built (Step 7). Two things are then owed to the **next** alpha's bump commit,
and are easy to forget because nothing fails without them: rename that
`[Unreleased]` to `## [<stable-version>] - <date>`, and delete the `-alpha`
entries it covers. Step 2, item 2.

**One compile, two packaging passes** only holds within a single CI run. When a
stable release is cut days after the alpha, `out/` is long gone, so the build
workflow checks out the target SHA and compiles again. Same source, deterministic
result — but budget a full build, not just a packaging pass.

## Pruning archived releases

R2 is append-only through the normal flow, so old `<variant>/v<version>/`
directories accumulate. `prune-releases.yml` is the manual cleanup:

```bash
# See what would go, without deleting anything (dry_run defaults to true)
gh workflow run prune-releases.yml --ref main \
  -f variant=alpha -f mode=older-than -f version=0.62.0-alpha

# Apply it
gh workflow run prune-releases.yml --ref main \
  -f variant=alpha -f mode=older-than -f version=0.62.0-alpha -f dry_run=false
```

- `mode=single` deletes exactly that version; `mode=older-than` deletes every
  archived version below it and **keeps the boundary itself**.
- The version currently published on that variant is never deleted, whichever
  mode is used. The run reads `<variant>/latest-{mac,,linux}.yml` first and
  protects every version they name.
- Plan logic lives in `scripts/prune-releases.ts` (unit-tested); the workflow
  only executes the plan, the same split as `set-latest`.
- `delete_github_release=true` additionally removes the GitHub Release. Read
  the invariant below first — this is the irreversible part, not the R2 delete.

## Recovery Patterns

| Failure | Action |
|---|---|
| Build workflow fails on one platform | Fix on main, re-trigger that platform only (same `variant` / `version`), reuse the other two platforms' existing run IDs in promote |
| Build fails immediately with `SUPERONE_VARIANT is required` | The dispatch omitted `-f variant=`. There is no default by design — a silent one ships a build under the wrong identity |
| Build fails with `must be a plain release version` | The base version (`package.json`, or `-f version=`) carries a prerelease tag. The variant appends its own — pass the plain number the error message names |
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
| R2 pointer yml has stale paths (no `v${VERSION}/` prefix) | The prefix is applied by `prefixVersionPaths` (`scripts/lib/channels.ts`) inside **set-latest**, not promote. If the live `<variant>/latest-mac.yml` lacks the `v<version>/` prefix, re-run `set-latest` for that tag/variant |
| Draft release has wrong tag or SHA | `gh release delete v<new-version> --cleanup-tag --yes`, then re-run promote |
| `set-latest` fails with `GetObjectTagging not implemented` | Cloudflare R2 does not implement object tagging, which `aws s3 cp` calls during an s3→s3 server-side copy. The fixed-link copy step passes `--copy-props none` to skip tag/metadata propagation. If you hit this, someone removed that flag — restore it. (The earlier `aws s3 cp out/ --recursive` for the ymls is a local→s3 upload and is unaffected) |
| `set-latest` staged nothing (semver guard held) | The target version is older than the variant's live version, so the guard skipped it (workflow logs `hold <variant>/<yml>: live X is newer`). Intended — to **roll back** to that older version, re-run with `force=true` |
| Already published and later found broken | Either ship a new patch version, or **roll the variant back** with `set-latest force=true` pointed at the last-good tag (re-points that variant's yml + fixed links to the good version without rewriting history). Broken **CLI** on npm cannot be un-published in place — ship a new lockstep patch and republish `@super-one/cli` |

## Invariants

- Local git never creates or force-pushes tags for releases. GitHub owns tag creation at publish time.
- `CHANGELOG.md` entries describe only **verified** behavior — no "may fix" or speculative claims.
- **`CHANGELOG.md`'s canonical timeline is the stable line.** `[Unreleased]` is the
  stable candidate and is updated by every alpha's bump commit; `-alpha` entries are
  working notes that are folded into a stable entry and deleted once it ships. A
  stable cut therefore modifies no file — see **CHANGELOG structure**. Never write a
  `## [<stable-version>]` heading as part of publishing that stable; it lands in the
  next alpha's bump commit.
- Alpha releases are always marked `isPrerelease=true` in GitHub for UI classification consistency. (R2 + GenericProvider auto-update does not depend on this flag — it is driven by the variant prefix the build points at.)
- `bun.lock` is never modified by the release flow.
- **Dual-publish is permanent**: `promote.yml` always uploads to both GitHub Release (flat layout) and R2 (`<variant>/v${VERSION}/` subdirectory). GitHub Release is the legacy path for clients built before the R2 switch, R2 is the source of truth for current/future clients. **Never** delete the GitHub Release upload step.
- **`set-latest` is decoupled from `promote`** and is never auto-invoked by it — running set-latest is a separate, explicit step. promote archives the build; set-latest makes a version a variant's latest + refreshes the fixed `{variant}/latest/` download links + is the rollback path (`force=true`). Manifest logic (semver compare, path prefix, version-less naming) lives in `scripts/lib/channels.ts` — **CI-only, kept out of the app bundle**; `@superone/shared/update-channels` exposes only `channelFromVersion`, which exists for `@super-one/cli` (no variant of its own) and is never called by the desktop app. set-latest reads each version's manifest from its **GitHub Release**, and **backfills the binaries to R2 from that Release if `v<version>/` is missing** (R2 is not guaranteed to keep every version), so it works for any historical version without a rebuild.
- **Deleting R2 binaries is recoverable; deleting the GitHub Release is not.** `set-latest` reads a version's manifest from its GitHub Release and backfills the binaries to R2 when `<variant>/v<version>/` is missing, so pruning R2 alone leaves every historical version rollable-back-to. Once the Release is gone that version can only be reproduced by rebuilding it. Prune R2 freely; pass `delete_github_release=true` only for versions you have decided never to return to.
- **A prune never deletes what a pointer references.** `<variant>/latest-*.yml` hands clients an exact `v<version>/` path, so removing that version 404s every download and every update on the variant with nothing failing in CI. `prune-releases.yml` reads the pointers before planning and aborts if it cannot (a 404 means "not published yet"; any other status fails the run rather than silently pruning with an empty guard).
- **Never rotate `UPDATER_TOKEN`** the GitHub PAT secret. Legacy alpha clients embed it in their ASAR for `PrivateGitHubProvider` auth. The secret is no longer consumed by any build workflow but **must** remain valid in GitHub Secrets indefinitely.
- **Pre-`v0.28.1-alpha` clients are abandoned on purpose.** They look for `latest-*.yml` on the newest non-draft prerelease Release, so publishing an alpha-variant release will offer them the `SuperOne Alpha` installer (different appId — macOS refuses it, Windows/Linux would install it beside them). They have been unable to update since the R2 switch regardless. Decided 2026-09-03: accept it. Do not rename the alpha ymls to dodge this without revisiting the decision — the naming is load-bearing for the variant split.
- **Relay deploys go through `deploy-relay.yml`, never local terminal.** The `CLOUDFLARE_API_TOKEN` lives only in GitHub repo secrets. Local `bun run deploy:relay` will fail in non-interactive shells, and skill permissions deliberately block credential discovery from shell rc files. Always dispatch the workflow.
- **Relay deploy is conditional on actual diff.** Only dispatch `deploy-relay.yml` when `git diff v<previous>..HEAD -- apps/relay/` is non-empty. No-op deploys just clutter Cloudflare's Version History with duplicate Version IDs and obscure the real protocol-changing deploys you'd want to roll back to.
- **`apps/relay/package.json` version skips intermediate releases.** It is bumped only on releases where relay actually deploys, and it jumps straight to the current release version. So the relay version may go `0.29.1-alpha → 0.35.0-alpha` if the six intermediate releases between them had no `apps/relay/` diff. This is what keeps `apps/relay/package.json` truthful: its version always matches the version actually running on Cloudflare for this commit lineage. **Never** lockstep-bump it just because the root or desktop version moved.
- **`@super-one/cli` locksteps with root/desktop version.** Every release dispatches `publish-cli.yml` with `-f version=<new-version>` (same string as `package.json` / app). Never publish pre-releases with npm dist-tag `latest`. Never install bare `@latest` / `@alpha` from desktop remote install — always pin the exact version. Workspace package `@superone/cli` stays private `0.0.0`; public package name is `@super-one/cli` produced by `apps/cli/scripts/pack-npm.ts`.
- **Harness R2 mirrors do not lockstep with every app version.** Dispatch `publish-harness.yml` only when `OFFICIAL_CLAUDE_SDK_VERSION` / `OFFICIAL_CODEX_NPM_VERSION` (or the pack/CDN script/workflow) changed since the previous tag — or when the user explicitly forces a refresh. Pins are read from source constants inside the workflow; **never** pass free-form package versions as workflow inputs (channel + dry_run only). Artifact keys are content-addressed by npm name + version (`harness/artifacts/...`), so re-publish of the same pin is idempotent. Channel manifests live at `harness/manifest/<alpha|stable>.json` and are independent of app auto-update ymls (`<variant>/latest-mac.yml`). Desktop install is **R2 primary, npm registry fallback**, one SHA-256 for both. Promote / set-latest **never** write under `harness/`.

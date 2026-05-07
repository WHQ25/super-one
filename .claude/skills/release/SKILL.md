---
name: release
description: "Automate the SuperOne release process: version bump, commit, per-platform build, promote artifacts to draft release, and publish. Trigger with /release [alpha|beta|public] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
user_invocable: true
arguments: "[alpha|beta|public] [major|feature|patch]"
---

# Release Skill

Automate the SuperOne release pipeline. The pipeline has four **independently retryable** phases — build, relay deploy, promote, publish — orchestrated via GitHub Actions workflow_dispatch:

- `build-mac.yml` / `build-win.yml` / `build-linux.yml` — each builds one platform, uploads artifacts to Actions storage (30-day retention). No release side effects.
- `deploy-relay.yml` — runs `bunx wrangler deploy` against `apps/relay/` to push the Cloudflare Worker (relay) to production. Authenticated by the repo `CLOUDFLARE_API_TOKEN` secret, so this **must** run inside Actions, never from a local terminal (the local shell typically lacks the token, and skill permissions block credential-discovery anyway). Independent of the build/promote chain — triggered in parallel with builds at Step 3.
- `promote.yml` — downloads artifacts, **dual-publishes** them: (a) creates a **draft** GitHub Release with flat asset layout (legacy auto-update path; legacy alpha clients embed `UPDATER_TOKEN` and pull from there); (b) restructures into `v${VERSION}/` subdirectory and `aws s3 sync`s to Cloudflare R2 bucket `super-one-releases` served at `https://dl.super-one.dev` (current auto-update source for post-switch clients + first-download URL).
- Final `gh release edit --draft=false --prerelease` — flips the draft to published; GitHub then materializes the tag on `target_commitish`.

Tags are created by GitHub at publish time, never pushed from local. A failing build or bad artifact can be re-run without burning a version number or force-pushing a tag.

**Channel** is auto-derived by electron-builder from the version string: `-alpha.N` → channel `alpha` (yml files `alpha-mac.yml` / `alpha.yml` / `alpha-linux.yml`); `-beta.N` → `beta`; `-rc.N` → `rc`; otherwise → `latest`. Each channel's "current pointer" yml is overwritten on each release; binaries under `v${VERSION}/` are append-only.

## Arguments

- **channel**: `alpha` (default). `beta` and `public` are reserved.
- **bump**: `patch` (default). `major` / `feature` / `patch` drive semver position:
  - `major`: `0.14.3-alpha` → `1.0.0-alpha`
  - `feature`: `0.14.3-alpha` → `0.15.0-alpha`
  - `patch`: `0.14.3-alpha` → `0.14.4-alpha`

## Workflow

### Step 1: Confirm version + CHANGELOG + relay-deploy decision (single turn)

This is the **only** human checkpoint in the pipeline. Do all of the following **in one response** and ask for a single combined confirmation:

1. Read `version` from `package.json`.
2. Parse args; default to `alpha` + `patch`. Reject `beta` / `public` (not yet supported) and stop.
3. Calculate the new version string.
4. `git log --oneline --no-decorate v<previous-version>..HEAD` to enumerate commits since the last release tag.
5. **Decide whether relay deploys this release**: run `git diff --quiet v<previous-version>..HEAD -- apps/relay/`. Non-empty diff → relay will be deployed and `apps/relay/package.json` will jump to the new version (skipping any intermediate versions where it wasn't deployed). Empty diff → relay is left alone.
6. Draft the CHANGELOG entry:
   - Drop noise (`chore(release): bump version`, purely internal refactors with no user impact).
   - Group by type — **Added** (feat), **Fixed** (fix), **Changed** (refactor affecting user behavior, dep upgrades with user impact), **Performance** (perf), **Tests** (test), **CI** (ci). Omit empty groups.
   - Concise, human-readable bullets. Combine related commits. No unverified claims ("may fix X") — only statements you can defend.
7. Show the user **all** of this in one message:
   - `Current: X.Y.Z-alpha → New: A.B.C-alpha`
   - `Relay deploy: yes (apps/relay/package.json: <previous-relay-version> → <new-version>)` **or** `Relay deploy: no (no apps/relay/ diff since v<previous-version>)`
   - The full drafted CHANGELOG entry (as the literal block that will be inserted)
8. Ask for one combined confirmation / edits.

After this confirmation, **everything below runs without further prompting** unless an actual error occurs. Do not ask the user to confirm before push, before build, before promote, or before publish.

### Step 2: Bump version, write CHANGELOG, commit, push

1. Insert `## [<new-version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`, right after the header block, with the confirmed entry.
2. Update `version` in **both** `package.json` (root) and `apps/desktop/package.json` to the new value — these always lockstep.
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

### Step 3: Trigger per-platform builds (+ relay deploy if Step 1 said yes)

Always fire the three platform builds. **If Step 1 decided relay deploys this release** (i.e. you bumped `apps/relay/package.json` in Step 2), also fire `deploy-relay.yml`. Both dispatches checkout the same `main` HEAD that contains the just-pushed release commit, so build artifacts and the deployed Worker map to the same source tree.

```bash
gh workflow run build-mac.yml    --ref main
gh workflow run build-win.yml    --ref main
gh workflow run build-linux.yml  --ref main

# Only if Step 1 said relay deploys this release:
gh workflow run deploy-relay.yml --ref main \
  -f message="v<new-version> (commit $(git rev-parse --short HEAD))"
```

Do NOT re-run the diff check here — Step 2's release commit always modifies `apps/relay/package.json` when relay deploys, so a fresh `git diff v<previous>..HEAD -- apps/relay/` would always be non-empty after Step 2 and lose the original signal. Carry the boolean from Step 1.

Record each dispatched run's URL / ID.

- Each build checks out the requested ref (`main` by default), runs `bun run build:<os> -- --publish never` → electron-builder produces `dist/` but uploads nowhere → `actions/upload-artifact@v4` → artifacts `dist-mac` / `dist-win` / `dist-linux` attached to the run (30-day retention).
- `deploy-relay.yml` checks out the same ref, runs `bunx wrangler deploy --message "<message>"` against `apps/relay/`, authenticated via the `CLOUDFLARE_API_TOKEN` repo secret. The `--message` value shows up in the Cloudflare dashboard's Version History so you can map version IDs back to git commits.
- **Diff scope used in Step 1**: `apps/relay/` is a self-contained Cloudflare Worker — its source does not import from `packages/shared` or any other workspace, so changes elsewhere in the monorepo never require a relay redeploy. If you later add such an import, expand the Step 1 diff path accordingly.
- **Manual override**: to force a relay deploy even when no source diff exists (e.g. after a rollback at the Cloudflare layer), do it outside this skill via `gh workflow run deploy-relay.yml ...` directly. Do not bump `apps/relay/package.json` for it — that field is reserved for "version actually deployed during a release", not for ad-hoc redeploys.

### Step 4: Monitor builds (+ relay deploy if dispatched)

Poll `gh run view <id> --json status,conclusion` for each dispatched run. Typical durations:

- **macOS build**: longest (~15 min, signing + notarization)
- **Linux / Windows builds**: 3-6 min
- **Relay deploy** (if dispatched): 2-3 min (small Worker, no native deps)

If any run fails:

- Inspect `gh run view <id> --log-failed | tail -40` to identify the root cause.
- Fix on `main`, push, and re-trigger ONLY that workflow. The successful run IDs from the other runs remain valid — `promote.yml` will pull each platform's artifact from its own run ID, and a re-deployed relay just supersedes the prior Cloudflare Version.
- Do NOT proceed to promote until all three builds are green (relay deploy can be in any state — promote does not depend on it).

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

Promote downloads each platform's artifact, then either creates a new draft release (with `--draft --prerelease`, tag name set) or uploads to an existing one with `--clobber`. Idempotent — safe to re-run.

### Step 6: Monitor promote + verify draft + verify R2 sync

1. Poll `gh run view <promote-run-id>` until complete.
2. **GitHub Release assertion**: `gh release view v<new-version> --json isDraft,isPrerelease,assets -q '.isDraft, .isPrerelease, (.assets | length), (.assets[].name)'` — expect `isDraft=true`, `isPrerelease=true` (alpha/beta/rc), and the channel-prefixed yml files in the asset list. Channel is derived from the new version: `<channel>-mac.yml` / `<channel>.yml` / `<channel>-linux.yml` where channel is `alpha` / `beta` / `rc` / `latest`. Full mac+win+linux is typically ~14 assets: 4 dmg/zip + 4 blockmap + 1 exe + 1 exe blockmap + 1 AppImage + 3 channel yml.
3. **R2 sync assertion**: confirm the R2 bucket also has the artifacts:
   ```bash
   curl -fsSL "https://dl.super-one.dev/<channel>-mac.yml" | head -20
   ```
   Expect `version: <new-version>`, and each `path:` / `files[].url:` field prefixed with `v<new-version>/`. The `Restructure staging for R2` step in promote.yml uses `yq` to rewrite these fields; verifying the prefix confirms that step ran. If the yml is 404 or version doesn't match, R2 sync failed — see Recovery Patterns.
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

### Step 8: Report

Show the user the final release URL and the tag SHA. Mention `git fetch origin --tags` so their local is in sync.

## Recovery Patterns

| Failure | Action |
|---|---|
| Build workflow fails on one platform | Fix on main, re-trigger that platform only, reuse the other two platforms' existing run IDs in promote |
| `deploy-relay.yml` fails | Inspect `gh run view <id> --log-failed`. Most common cause: `CLOUDFLARE_API_TOKEN` repo secret missing, expired, or scoped wrong (needs `Account: Workers Scripts:Edit` + `Account:Read`). Fix the secret in repo Settings → Secrets, then re-run the workflow — wrangler deploys are idempotent so the new run just supersedes the prior partial state. Build/promote/publish are independent and can proceed regardless |
| Promote workflow fails mid-upload (GitHub side) | Re-trigger promote with the same tag — `--clobber` replaces any partial assets |
| Promote workflow fails on R2 sync step | The GitHub Release upload happens before the R2 sync step in promote.yml, so the GitHub side can be intact while R2 is empty. Re-trigger promote with the same tag — `aws s3 sync` is idempotent (same key = update); the GitHub upload step uses `--clobber` |
| Promote fails with `getaddrinfo ENOTFOUND sts.<region>.amazonaws.com` | Do **NOT** use `aws-actions/configure-aws-credentials@v4` for R2 — its default STS credential validation tries to call AWS STS, which doesn't apply to Cloudflare R2 (region `auto` produces `sts.auto.amazonaws.com` NXDOMAIN). promote.yml injects R2 creds as `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_DEFAULT_REGION` env vars directly on the sync step, no action wrapper. If you see this error, someone re-introduced the action — remove it |
| R2 yml has stale paths (no `v${VERSION}/` prefix) | The `Restructure staging for R2` step in promote.yml didn't run or yq failed. Check the promote run log for the `Rewriting paths in ...` lines. Re-trigger promote |
| Draft release has wrong tag or SHA | `gh release delete v<new-version> --cleanup-tag --yes`, then re-run promote |
| Already published and later found broken | Leave the broken release as-is (alpha users get it and can report), ship a new patch version; don't rewrite history |

## Invariants

- Local git never creates or force-pushes tags for releases. GitHub owns tag creation at publish time.
- `CHANGELOG.md` entries describe only **verified** behavior — no "may fix" or speculative claims.
- Alpha/beta/rc releases are always marked `isPrerelease=true` in GitHub for UI classification consistency. (R2 + GenericProvider auto-update no longer depends on this flag — it's driven by the channel-suffixed yml filename.)
- `bun.lock` is never modified by the release flow.
- **Dual-publish is permanent**: `promote.yml` always uploads to both GitHub Release (flat layout) and R2 (`v${VERSION}/` subdirectory). GitHub Release is the legacy path for clients built before the R2 switch, R2 is the source of truth for current/future clients. **Never** delete the GitHub Release upload step.
- **Never rotate `UPDATER_TOKEN`** the GitHub PAT secret. Legacy alpha clients embed it in their ASAR for `PrivateGitHubProvider` auth; rotating the token bricks their auto-update path. The secret is no longer consumed by any build workflow but **must** remain valid in GitHub Secrets indefinitely.
- **Relay deploys go through `deploy-relay.yml`, never local terminal.** The `CLOUDFLARE_API_TOKEN` lives only in GitHub repo secrets. Local `bun run deploy:relay` will fail in non-interactive shells, and skill permissions deliberately block credential discovery from shell rc files. Always dispatch the workflow.
- **Relay deploy is conditional on actual diff.** Only dispatch `deploy-relay.yml` when `git diff v<previous>..HEAD -- apps/relay/` is non-empty. No-op deploys just clutter Cloudflare's Version History with duplicate Version IDs and obscure the real protocol-changing deploys you'd want to roll back to.
- **`apps/relay/package.json` version skips intermediate releases.** It is bumped only on releases where relay actually deploys, and it jumps straight to the current release version. So the relay version may go `0.29.1-alpha → 0.35.0-alpha` if the six intermediate releases between them had no `apps/relay/` diff. This is what keeps `apps/relay/package.json` truthful: its version always matches the version actually running on Cloudflare for this commit lineage. **Never** lockstep-bump it just because the root or desktop version moved.

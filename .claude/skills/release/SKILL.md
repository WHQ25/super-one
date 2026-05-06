---
name: release
description: "Automate the SuperOne release process: version bump, commit, per-platform build, promote artifacts to draft release, and publish. Trigger with /release [alpha|beta|public] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
user_invocable: true
arguments: "[alpha|beta|public] [major|feature|patch]"
---

# Release Skill

Automate the SuperOne release pipeline. The pipeline has three **independently retryable** phases — build, promote, publish — orchestrated via GitHub Actions workflow_dispatch:

- `build-mac.yml` / `build-win.yml` / `build-linux.yml` — each builds one platform, uploads artifacts to Actions storage (30-day retention). No release side effects.
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

### Step 1: Confirm version + CHANGELOG (single turn)

This is the **only** human checkpoint in the pipeline. Do all of the following **in one response** and ask for a single combined confirmation:

1. Read `version` from `package.json`.
2. Parse args; default to `alpha` + `patch`. Reject `beta` / `public` (not yet supported) and stop.
3. Calculate the new version string.
4. `git log --oneline --no-decorate v<previous-version>..HEAD` to enumerate commits since the last release tag.
5. Draft the CHANGELOG entry:
   - Drop noise (`chore(release): bump version`, purely internal refactors with no user impact).
   - Group by type — **Added** (feat), **Fixed** (fix), **Changed** (refactor affecting user behavior, dep upgrades with user impact), **Performance** (perf), **Tests** (test), **CI** (ci). Omit empty groups.
   - Concise, human-readable bullets. Combine related commits. No unverified claims ("may fix X") — only statements you can defend.
6. Show the user **both** in one message:
   - `Current: X.Y.Z-alpha → New: A.B.C-alpha`
   - The full drafted CHANGELOG entry (as the literal block that will be inserted)
7. Ask for one combined confirmation / edits.

After this confirmation, **everything below runs without further prompting** unless an actual error occurs. Do not ask the user to confirm before push, before build, before promote, or before publish.

### Step 2: Bump version, write CHANGELOG, commit, push

1. Insert `## [<new-version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`, right after the header block, with the confirmed entry.
2. Update `package.json` `version` to the new value. Do NOT modify `bun.lock` (version bumps don't touch deps).
3. `git add package.json CHANGELOG.md && git commit -m "chore(release): bump version to <new-version>"`
4. **Do NOT create a local git tag**. Tag creation is deferred to GitHub at publish time.
5. `git push origin main` (no `--tags`). No confirmation needed — already covered by Step 1.

### Step 3: Trigger per-platform builds

For each platform that should be built (default: all three), fire `workflow_dispatch`:

```bash
gh workflow run build-mac.yml   --ref main
gh workflow run build-win.yml   --ref main
gh workflow run build-linux.yml --ref main
```

Record each run's URL / ID. Each build:

- Checks out the requested ref (`main` by default)
- Runs `bun run build:<os> -- --publish never` → electron-builder produces `dist/` but uploads nowhere
- `actions/upload-artifact@v4` → artifacts `dist-mac` / `dist-win` / `dist-linux` attached to the run (30-day retention)

### Step 4: Monitor builds

Poll `gh run view <id> --json status,conclusion` for each run. macOS is the longest (~15 min, signing + notarization); Linux and Windows usually finish in 3-6 min.

If any build fails:

- Inspect `gh run view <id> --log-failed | tail -40` to identify the root cause.
- Fix on `main`, push, and re-trigger ONLY that platform's workflow. The other two platforms' successful artifacts remain valid — `promote.yml` will pull each from its own run ID.
- Do NOT proceed to promote until all three builds are green (or the user explicitly asks for a partial promote).

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

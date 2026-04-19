---
name: release
description: "Automate the SuperOne release process: version bump, commit, per-platform build, promote artifacts to draft release, and publish. Trigger with /release [alpha|beta|public] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
user_invocable: true
arguments: "[alpha|beta|public] [major|feature|patch]"
---

# Release Skill

Automate the SuperOne release pipeline. The pipeline has three **independently retryable** phases — build, promote, publish — orchestrated via GitHub Actions workflow_dispatch:

- `build-mac.yml` / `build-win.yml` / `build-linux.yml` — each builds one platform, uploads artifacts to Actions storage (30-day retention). No release side effects.
- `promote.yml` — downloads artifacts from specified build runs and assembles a **draft** GitHub release with the chosen tag name. Does NOT create a git tag yet.
- Final `gh release edit --draft=false --prerelease` — flips the draft to published; GitHub then materializes the tag on `target_commitish`.

Tags are created by GitHub at publish time, never pushed from local. A failing build or bad artifact can be re-run without burning a version number or force-pushing a tag.

## Arguments

- **channel**: `alpha` (default). `beta` and `public` are reserved.
- **bump**: `patch` (default). `major` / `feature` / `patch` drive semver position:
  - `major`: `0.14.3-alpha` → `1.0.0-alpha`
  - `feature`: `0.14.3-alpha` → `0.15.0-alpha`
  - `patch`: `0.14.3-alpha` → `0.14.4-alpha`

## Workflow

### Step 1: Parse and Validate

1. Read `version` from `package.json`.
2. Parse args; default to `alpha` + `patch`.
3. Reject `beta` / `public` channels (not yet supported) and stop.
4. Calculate the new version string.
5. Show the user: `Current: X.Y.Z-alpha → New: A.B.C-alpha` and ask for confirmation before proceeding.

### Step 2: Update CHANGELOG

1. `git log --oneline --no-decorate v<previous-version>..HEAD` to enumerate commits since the last release tag.
2. Drop noise (`chore(release): bump version`, purely internal refactors with no user impact).
3. Group by type — **Added** (feat), **Fixed** (fix), **Changed** (refactor affecting user behavior, dep upgrades with user impact), **Performance** (perf), **Tests** (test), **CI** (ci). Omit empty groups.
4. Write concise, human-readable bullets. Combine related commits. Do NOT write unverified claims ("may fix X") — only ship statements you can defend.
5. Insert `## [<new-version>] - <YYYY-MM-DD>` at the top of `CHANGELOG.md`, right after the header block.
6. Show the drafted entry to the user and ask for confirmation or edits before continuing.

### Step 3: Bump Version and Push main

1. Update `package.json` `version` to the new value. Do NOT modify `bun.lock` (version bumps don't touch deps).
2. Stage + commit: `git add package.json CHANGELOG.md && git commit -m "chore(release): bump version to <new-version>"`
3. **Do NOT create a local git tag**. Tag creation is deferred to GitHub at publish time.
4. Ask the user to confirm before pushing. On confirmation: `git push origin main` (no `--tags`).

### Step 4: Trigger per-platform builds

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

### Step 5: Monitor builds

Poll `gh run view <id> --json status,conclusion` for each run. macOS is the longest (~15 min, signing + notarization); Linux and Windows usually finish in 3-6 min.

If any build fails:

- Inspect `gh run view <id> --log-failed | tail -40` to identify the root cause.
- Fix on `main`, push, and re-trigger ONLY that platform's workflow. The other two platforms' successful artifacts remain valid — `promote.yml` will pull each from its own run ID.
- Do NOT proceed to promote until all three builds are green (or the user explicitly asks for a partial promote).

### Step 6: Trigger promote

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

### Step 7: Monitor promote + verify draft

1. Poll `gh run view <promote-run-id>` until complete.
2. `gh release view v<new-version> --json isDraft,isPrerelease,assets -q '.isDraft, .isPrerelease, (.assets | length), (.assets[].name)'` — expect `isDraft=true`, `isPrerelease=true`, and exactly the set of artifacts expected (typically 14 for full mac+win+linux: 4 dmg/zip + 4 blockmap + 1 exe + 1 exe blockmap + 1 AppImage + 3 `latest-*.yml`).
3. Download the platform-appropriate DMG/EXE/AppImage and smoke-test locally:
   ```bash
   gh release download v<new-version> --pattern "*arm64.dmg" -D ~/Downloads/
   ```
4. Ask the user to confirm local install works before publishing.

### Step 8: Publish

Extract the changelog entry for this version from `CHANGELOG.md` (everything between the `## [<new-version>]` heading and the next `##` heading). Use a HEREDOC so formatting is preserved:

```bash
NOTES=$(awk '/^## \[<new-version>\]/{flag=1;next} /^## \[/{flag=0} flag' CHANGELOG.md)
gh release edit v<new-version> --draft=false --prerelease --notes "$NOTES"
```

**Alpha/beta MUST use `--prerelease`** — without it, `electron-updater`'s `allowPrerelease` resolution picks the wrong release and breaks auto-update for existing pre-release users (documented failure mode from `v0.21.2-alpha`).

For `public` (future): omit `--prerelease`.

Publishing materializes the tag on `target_commitish` (the SHA supplied to promote). Run `git fetch origin --tags` afterwards so the local repo has the new tag.

### Step 9: Confirm

Show the user the final release URL and the tag SHA. Mention `git fetch origin --tags` so their local is in sync.

## Recovery Patterns

| Failure | Action |
|---|---|
| Build workflow fails on one platform | Fix on main, re-trigger that platform only, reuse the other two platforms' existing run IDs in promote |
| Promote workflow fails mid-upload | Re-trigger promote with the same tag — `--clobber` replaces any partial assets |
| Draft release has wrong tag or SHA | `gh release delete v<new-version> --cleanup-tag --yes`, then re-run promote |
| Smoke test reveals regression | Fix on main, re-run Steps 3–7 with a new patch version; do NOT reuse a tag that had a bad artifact |
| Already published and later found broken | Leave the broken release as-is (alpha users get it and can report), ship a new patch version; don't rewrite history |

## Invariants

- Local git never creates or force-pushes tags for releases. GitHub owns tag creation at publish time.
- `CHANGELOG.md` entries describe only **verified** behavior — no "may fix" or speculative claims.
- Alpha/beta releases are always marked `isPrerelease=true` in GitHub, otherwise `electron-updater` version resolution breaks for existing pre-release users.
- `bun.lock` is never modified by the release flow.

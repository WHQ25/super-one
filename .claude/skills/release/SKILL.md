---
name: release
description: "Automate the SuperOne release process: version bump, commit, tag, push, CI monitoring, and GitHub release publishing. Trigger with /release [alpha|beta|public] [major|feature|patch]. Use this skill whenever the user wants to release, publish, ship, or deploy a new version of the app."
user_invocable: true
arguments: "[alpha|beta|public] [major|feature|patch]"
---

# Release Skill

Automate the full SuperOne release pipeline based on the channel and bump type.

## Arguments

- **channel**: `alpha` (default) — the release channel. `beta` and `public` are reserved for future use.
- **bump**: `patch` (default) — which version segment to increment.
  - `major`: bump the first number (e.g., `0.14.3-alpha` → `1.0.0-alpha`)
  - `feature`: bump the second number, reset patch to 0 (e.g., `0.14.3-alpha` → `0.15.0-alpha`)
  - `patch`: bump the third number (e.g., `0.14.3-alpha` → `0.14.4-alpha`)

## Workflow

### Step 1: Parse and Validate

1. Read the `version` field from `package.json`.
2. Parse the arguments. Default to `alpha` channel and `patch` bump if omitted.
3. If channel is `beta` or `public`, tell the user these are not yet supported and stop.
4. Calculate the new version string based on bump type and channel suffix.
5. Show the user: `Current: X.Y.Z-alpha → New: A.B.C-alpha` and ask for confirmation before proceeding.

### Step 2: Bump Version

1. Update the `version` field in `package.json` to the new version.
2. Do NOT run `bun install` or modify `bun.lock` — version bumps don't affect dependencies.

### Step 3: Commit and Tag

1. Stage only `package.json`: `git add package.json`
2. Commit with message: `chore(release): bump version to <new-version>`
3. Create tag: `git tag v<new-version>`

### Step 4: Push

1. Show the user a summary of what will be pushed (new version, commit, tag).
2. Ask the user to confirm before pushing.
3. Only after confirmation: `git push origin main --tags`
4. Confirm push succeeded.

### Step 5: Monitor CI

1. Wait 10 seconds, then check CI status: `gh run list --limit 1`
2. If the run is still in progress, poll every 60 seconds using `gh run list --limit 1` until it completes.
3. If CI fails, show the error and stop. Do NOT proceed to publish.

### Step 6: Publish Release

Once CI passes:

- For `alpha`/`beta`: `gh release edit v<new-version> --draft=false --prerelease`
- For `public` (future): `gh release edit v<new-version> --draft=false`

Alpha/beta releases MUST use `--prerelease` — otherwise `electron-updater` version resolution breaks for users with prerelease versions installed.

### Step 7: Confirm

Tell the user the release is published and provide the release URL.

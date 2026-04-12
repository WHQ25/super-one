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

### Step 2: Update CHANGELOG

1. Run `git log --oneline --no-decorate v<previous-version>..HEAD` to get all commits since the last release tag.
2. Filter out noise commits (e.g., `chore(release): bump version`).
3. Group commits by type: **Added** (feat), **Fixed** (fix), **Performance** (perf), **Refactored** (refactor), **Tests** (test), **Styling** (style), **CI** (ci). Omit empty groups.
4. Write a concise, human-readable entry — not a raw git log dump. Combine related commits into single bullet points where appropriate.
5. **For alpha/beta**: Insert the new entry at the top of the changelog, right after the header.
6. **For public (future)**: Aggregate all alpha/beta entries since the last public release into a single public version entry. Keep the alpha/beta entries below as history.
7. Open `CHANGELOG.md`, insert the new `## [<new-version>] - <YYYY-MM-DD>` section at the correct position.
8. Show the user the drafted changelog entry and ask for confirmation or edits before proceeding.

### Step 3: Bump Version

1. Update the `version` field in `package.json` to the new version.
2. Do NOT run `bun install` or modify `bun.lock` — version bumps don't affect dependencies.

### Step 4: Commit and Tag

1. Stage `package.json` and `CHANGELOG.md`: `git add package.json CHANGELOG.md`
2. Commit with message: `chore(release): bump version to <new-version>`
3. Create tag: `git tag v<new-version>`

### Step 5: Push

1. Show the user a summary of what will be pushed (new version, commit, tag, changelog entry).
2. Ask the user to confirm before pushing.
3. Only after confirmation: `git push origin main --tags`
4. Confirm push succeeded.

### Step 6: Monitor CI

1. Wait 10 seconds, then check CI status: `gh run list --limit 1`
2. If the run is still in progress, poll every 60 seconds using `gh run list --limit 1` until it completes.
3. If CI fails, show the error and stop. Do NOT proceed to publish.

### Step 7: Publish Release

Once CI passes, extract the changelog entry for this version from `CHANGELOG.md` (everything between the `## [<new-version>]` heading and the next `##` heading) and use it as the GitHub release body:

- For `alpha`/`beta`: `gh release edit v<new-version> --draft=false --prerelease --notes "$(changelog content)"`
- For `public` (future): `gh release edit v<new-version> --draft=false --notes "$(changelog content)"`

Use a HEREDOC to pass the notes to ensure correct formatting. Alpha/beta releases MUST use `--prerelease` — otherwise `electron-updater` version resolution breaks for users with prerelease versions installed.

### Step 8: Confirm

Tell the user the release is published and provide the release URL.

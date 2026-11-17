# Worktree disk space

SuperOne cuts session worktrees under `~/.worktrees/<repo>/<name>` with
`git worktree add`. A worktree shares the repository's object store, so what it
costs is its checked-out files plus whatever is later built or installed inside
it. Three things keep that small: a sparse checkout, directories shared with the
main checkout, and removing worktrees nothing uses any more.

## Repository settings

A repository opts in with `.superone/worktree.json` in its **main checkout**:

```json
{
  "sparsePaths": ["apps/desktop", "packages"],
  "sharedPaths": ["node_modules", "apps/desktop/node_modules"]
}
```

`activateWorktree` in `packages/runtime/src/git/worktree-ops.ts` reads the file
each time it creates a worktree. Every creation path goes through it (a new
session, a fork, a collaboration child, a suggested task, the node's
`git.worktreeActivate`), on the desktop and on a remote node alike, so the
settings need no UI and no protocol field. The file is read from the main
checkout rather than the new worktree, so it works whether it is committed or
git-ignored. A missing or malformed file, or a path that is absolute, leaves the
checkout, or points into `.git`, is ignored: the result is a plain full
worktree, never a failed creation.

### `sparsePaths`

Directories to check out, in git's cone mode: the listed directories with
everything below them, plus the files directly in the repository root and in
each parent directory of a listed one. The worktree is added with
`--no-checkout`, then `git sparse-checkout init --cone`, `sparse-checkout set`,
and `git checkout HEAD` write the files.

- The whole history is still available; only the working files are narrowed.
  `git sparse-checkout add <dir>` inside the worktree widens it later.
- `sparse-checkout init` turns on `extensions.worktreeConfig` for the
  repository, so the setting lives in that worktree's own config and the main
  checkout stays full.
- If the sparse checkout fails, the new worktree (and the branch created for it)
  is removed and creation fails with git's error.
- Carrying local changes into a sparse worktree only applies changes that fall
  inside it; the rest stay in the source checkout.

### `sharedPaths`

Git-ignored paths (dependency and cache directories) that a new worktree links
to instead of recreating. For each path that exists in the main checkout, is
ignored there, and does not already exist in the worktree, SuperOne creates a
symbolic link (a junction for directories on Windows) to the main checkout's
copy. A tracked path is never linked. Linking is best effort and never fails
creation.

A `dir/` ignore rule does not match a link, so the path is also added to the
repository's `info/exclude`; otherwise the link would show as untracked and be
picked up by carry and handoff.

A shared directory is one directory: an install run in any worktree changes it
for the main checkout and every other worktree. Share a dependency directory
only when the branches use the same dependencies. Package managers that
hard-link from a global store (Bun, pnpm) already avoid most of the duplicate
bytes, so for them sharing mainly saves the install time.

## Removing unused worktrees

SuperOne does not remove a worktree when its session is deleted; the files may
still be wanted. **Settings → Storage → Worktrees** lists the worktrees under
`~/.worktrees` with their size, and removes the unused ones on request.

- A worktree is **in use** when a session's recorded worktree path or a sidebar
  project is that directory or inside it. In-use worktrees are shown as one
  total and cannot be removed here.
- **Remove Unused** removes every unused worktree without uncommitted changes.
  One with uncommitted changes is removed only from its own row, after a
  warning.
- Removal is `git worktree remove --force`; the branch and its commits stay in
  the repository. A directory git no longer tracks is deleted and
  `git worktree prune` clears its record.
- The main process checks again before each removal that the path sits directly
  under a repository directory of `~/.worktrees` and is still unused.
- Size counts regular files and does not follow links, so a shared directory
  counts as nothing. Files hard-linked from a package manager's store are
  counted in full although removing the worktree frees less.
- Worktrees are left out of one-click Optimize, and measuring them runs
  separately from the rest of the page because it walks every file.

Code: `apps/desktop/src/main/storage-worktrees.ts`,
`apps/desktop/src/renderer/src/components/settings/WorktreeStorageSection.tsx`.

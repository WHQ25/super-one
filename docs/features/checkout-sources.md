# Checkout sources

The desktop location popover (Local tab) lists this checkout's branches in
one group with git remote branches it does not have yet and every open pull
request. A row is the branch name only. Clicking a local branch switches to
it. Clicking a remote branch or a pull request checks that tip out. Searching
for a name the list does not have offers to create that branch. The list
scrolls at the same max height as the existing-worktree list.

Branches on another environment are not in that list. Moving one is a sync:
the commits travel from one machine to the other. A Sync Branches row at the
bottom of the Local tab opens over the branch list, the same way choosing a
base branch covers the existing worktrees. Identical tips are left out. Each
row names the branch, then the other environment and how that tip compares
with the same branch, separated by a middle dot. A missing branch is new.
Ahead and behind include how many commits. A tip can also be diverged, or
not compared yet. Selecting a row keeps one action under the list. A new branch, a diverged
tip, or a tip that is not here yet offers to create a new branch at that
commit. A missing name uses the remote name. An existing name is left alone
and the new branch defaults to `name-source`. When the other environment is
ahead, the action fast-forwards this branch to that tip. When it is behind,
the action fast-forwards their branch to this tip. The current checkout
stays where it is.

## Sources and targets

| Source | Offered to | Branches come from | Lands by |
|---|---|---|---|
| Environment: this computer or a node with a checkout of the same normalized origin (`repoIdentity`) | Every checkout, except the environment it is on | `git.branchTips` on a node; local git for this computer | Incremental git bundle relayed by this desktop |
| Git remote | This computer's checkouts | Remote-tracking refs as of the last fetch; fetched in the background when stale | Remote-tracking ref |
| Pull requests | This computer's checkouts with a remote; disabled until `gh` can read the repository | `gh pr list` | `git fetch <origin> refs/pull/<n>/head` |

Offline and upgrade-needed environments stay in the sync section, with the
reason, and their branches are not mixed into the branch list. A node that does not serve the
`git.*` methods below reports that it is too old.

## Moving a branch between environments

No shared git remote is involved, so unpushed work can move. This desktop
relays every transfer. A move between two nodes therefore downloads the
bundle from one and uploads it to the other.

1. The desktop walks the origin's branch from the tip until it finds a commit
   the target already has (`git.revList` on a node origin, `git.presentCommits`
   on a node target). That commit is the common ancestor. A node that cannot
   list or check commits falls back to the target's ref tips
   (`git.bundleHaves`).
2. The origin bundles the branch against that ancestor (`git.exportBundle` on a
   node), so only missing commits travel. If the branch is checked out in a
   worktree there and "include uncommitted changes" is on, the origin commits
   the working tree as a WIP commit on top. It uses a temporary index and a
   throwaway ref, so the origin's worktree, index and HEAD are unchanged.
3. A node origin's bundle is downloaded with `fs.readTempFile`. A node
   target receives it in `git.uploadBundle` chunks under a client-chosen
   upload id, and lands it with `git.applyIncomingBranch`. Bundles and
   uploads left in temp directories expire after 30 minutes.

Each step reports its progress: bundling, then downloading and uploading in
bytes, fetching, and applying. The popover shows the current step and the
transfer bytes, with Cancel. Cancelling stops between transfer chunks and
before the target changes; nothing is landed. Once applying starts, the step
runs to completion.

## Landing a tip

Every target lands through `applyIncomingBranch`
(`packages/runtime/src/git/branch-bundle.ts`), under the host's per-repository lock:

- **New name**: the branch is created. "Save as" only creates, and refuses an existing name.
- **Fast-forward**: the branch is moved.
- **Earlier WIP snapshot**: an earlier WIP snapshot (marked by the
  `SuperOne-Snapshot` trailer) whose parent the incoming tip contains is replaced.
- **Diverged**: the import stops. The user can overwrite, which keeps the
  old tip as `superone-backup/<branch>/<sha7>`, or save under another name.
- **Checked-out branch**: a branch checked out in the target moves with
  `git reset --keep`, which refuses rather than overwrite uncommitted edits.

Switching the checkout to the branch is a separate step through the ordinary
branch switch, so its failure dialog applies.

## Tracking (this computer's checkouts)

A branch from a git remote gets an ordinary upstream. A branch from an
environment or a pull request records `branch.<name>.superoneSource` (JSON
with the source and its ref). The branch list does not show that record.

A node checkout keeps no record. A recorded source names an environment
by this controller's connection id, so it would mean nothing to another
controller.

Each incoming tip is still compared with the target's branch: `new`,
`same`, `behind`, `ahead`, `diverged`, or `update` when the target does not
have that commit yet. The list uses the comparison to decide which rows to
show. It does not print the comparison on the row.

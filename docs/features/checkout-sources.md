# Checkout sources

The desktop location popover (Local tab) can create or update a branch from
somewhere other than the checkout itself. Under New Branch, "Check Out Branch
from <source>" opens a source. The source chip switches between sources, and
the last one used is remembered per checkout.

## Sources and targets

| Source | Offered to | Branches come from | Lands by |
|---|---|---|---|
| Environment: this computer or a node with a checkout of the same normalized origin (`repoIdentity`) | Every checkout, except the environment it is on | `git.branchTips` on a node; local git for this computer | Incremental git bundle relayed by this desktop |
| Git remote | This computer's checkouts | Remote-tracking refs as of the last fetch; fetched in the background when stale | Remote-tracking ref |
| Pull requests | This computer's checkouts with a remote; disabled until `gh` can read the repository | `gh pr list` | `git fetch <origin> refs/pull/<n>/head` |

Offline and upgrade-needed environments stay in the menu, disabled with the
reason. A node that does not serve the `git.*` methods below reports that it
is too old.

## Moving a branch between environments

No shared git remote is involved, so unpushed work can move. This desktop
relays every transfer. A move between two nodes therefore downloads the
bundle from one and uploads it to the other.

1. The target lists the commits it has (`git.bundleHaves` on a node).
2. The origin bundles the branch against them (`git.exportBundle` on a
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
with the source and its ref). The branch list shows a badge for recorded
sources, and for upstream branches that are behind or diverged. A behind
badge syncs in place; a diverged badge opens the source on that branch.

A node checkout keeps no record. A recorded source names an environment
by this controller's connection id, so it would mean nothing to another
controller. A node checkout's popover therefore shows no badges.

Branch rows show how each incoming tip relates to the target's branch:
`new`, `same`, `behind`, `ahead`, or `diverged`. When the target does not
have the tip yet, the row shows `update`.

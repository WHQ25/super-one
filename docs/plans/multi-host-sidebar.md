# Multi-host sidebar

Status: in-progress · Updated: 2026-10-22
Goal: One desktop window lists and starts sessions on every connected environment, and a new session owns its worktree instead of copying the focused session's.
Proposal: [multi-host-sidebar.md](../proposals/multi-host-sidebar.md)
Long-term docs affected: [remote-node-service.md](../architecture/remote-node-service.md)

## Decisions

Open questions from the proposal, settled here.

1. **Merged-project actions name the environment in a submenu.** Rename, remove and edit-extra-dirs on a row that merges several checkouts open a submenu of `environment · path`. One checkout keeps today's single action. A merged row has no single path, and a second dialog would hide which machine is about to change.

2. **`repoIdentity` stays the normalized `origin` URL.** Forks with a different origin stay separate projects. Extra remotes do not join the group. That is already what `ProjectSnapshot.repoIdentity` and [remote-node-service.md](../architecture/remote-node-service.md) §14.3 mean by "the same repository". Changing the identity would be a registry migration, not a sidebar change.

3. **Pinned sessions and drafts stay one flat list.** The environment shows up in the session hover card, and on the row only when that environment is offline. Grouping this short list by the sidebar mode would split pins the user expects to stay together. The proposal already says a session row does not name its environment.

4. **Multi-host chrome stays behind `experimentalRemoteNodesEnabled`.** The flag off, or the flag on with only this machine, keeps today's single-host sidebar: a "Projects" label, local projects, no environment group-by, no environment dropdown. The global host filter is removed in both cases. It was already hidden while the flag was off.

5. **Two chips, one selector.** The accepted proposal keeps the workdir chip and the branch chip, both reading `(environment, cwd, branch)` from the session or the pending new-session selection. The prototype's later single chip is the reference for the workdir popover (environment dropdown, checkout versus worktree, remote-tracking refs). The written rule that the branch chip stays hidden while a worktree create is pending stays in force.

6. **The sidebar does not dial every paired node.** Project lists load for environments that are already connected. `desired: false`, offline, and disconnected buckets stay empty with an offline header. Auto-connecting each host on mount would undo an explicit disconnect.

7. **A remote with no `installationProfile` is a CLI node.** Remote desktops set `local-electron`. Headless installs set `systemd-user`, `nohup`, and the other CLI profiles. Behaviour is the same; only the icon differs.

8. **The file-tree root may still cache the focused session.** `useAppStore._worktrees` cannot be deleted outright: the app store cannot import the chat store synchronously, and the file tree reads that map. New sessions and drafts never read it. The session's own `{ environmentId, selection }` is the source. The map is updated from the focused session after that session is already active, and it is cleared in the same synchronous turn that a new session becomes active.

## Phases

### 1. Data layer

- Per-environment project catalog with loading and error, no auto-dial.
- Lazy session pages keyed by `ProjectRef` (`environmentId:projectId`).
- Persisted group-by, sort and expanded keys.
- `installationProfile` → local / CLI node / remote desktop.
- New sidebar code routes with `ProjectRef` and keeps the legacy path key only at the `selectProject` boundary.

### 2. Sidebar

- Project mode merges by normalized `repoIdentity`. Environment mode nests environment → project → session.
- Session hover card from list data only.
- Offline rows dimmed, with a disconnected icon.
- Host filter removed. Group-by tabs appear only when multi-host chrome is on.

### 3. Workdir picker

- Environment dropdown at the top of the popover, default this machine.
- Selectable, needs-upgrade, clone-here, and disabled states. Clone uses `git.clone` into the node's projects directory when the caller passes no parent.
- `{ environmentId, selection }` lives on the session and the draft.
- Both chips read one selector.
- A started session's popover is read-only for the environment. Worktrees do not cross environments.
- Regression: a new session created while the focused session is in a worktree starts at the project root, including when `clearWorktree` is slow.

### 4. Branches

- Remote branch listing passes `cwd`.
- Remote-tracking refs are a separate list. Fetch uses `git.fetch`. Picking `origin/x` checks out local tracking branch `x`.
- `GIT_INIT` accepts a remote path.

## Progress

| Phase | Status | Verification |
|---|---|---|
| Proposal copied | done | `9c893f67d` |
| Plan | done | `75728fd9d` |
| 1 Data layer | done | `bunx vitest run` from `apps/desktop`: catalog 11, `use-sidebar-sessions` 6, `AppSidebarRefresh` 2, `AppSidebar` 29, all passed. `typecheck:web` and `typecheck:node` still fail on existing errors outside this change (`ChatStatusBar.stories.tsx` `GitDirtyStatus` null, `packages/shared/src/transcript-boundary.ts` TS2532). |
| 2 Sidebar | not started | |
| 3 Workdir | not started | |
| 4 Branches | not started | |

## Blockers

None yet.

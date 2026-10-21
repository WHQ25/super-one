# Multi-host sidebar

Status: implementation complete, unpushed · Updated: 2026-10-22
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

9. **A merged repository is a header plus one row per checkout.** `ProjectSidebarRow` binds every session to `folder.path`, so one merged row cannot own several checkouts. The header key is `group:${mergeKey}` and its edit and remove actions are the submenu from decision 1. Each nested row is labeled with the environment name. A repository with one checkout stays a single row. `collapsedEnvironmentIds` is stored instead of an expanded list: empty means every environment starts open, and nothing has been released with the old key.

10. **The session owns the checkout.** `worktreeHintForSession` and `snapshotDraftSettings` read `_worktreePath` and `environmentSelection`. They do not copy `_worktrees[project].activePath` onto a session whose path is null. Tests that required that copy now expect null.

11. **`environmentSelection` stays optional.** Existing session literals and reloaded rows have no column for it. `createDefaultPerSessionState` leaves it null, and a null selection still falls through to the file-tree cache so in-flight sessions keep working. New Session stamps `selectionForNewSession` with the connection id on the project route (`local`, or the remote connection id). After the user picks an environment, the stored id is the catalog environment id. A reloaded session with a null selection plus `_worktreePath` is treated as an existing checkout.

12. **Clear the mirror after the outgoing draft is saved, and before the active session changes.** `resetSessionImpl` awaits `promoteDraftIfUnsent`, then calls `clearWorktreeMirror`, then switches `_activeSessionId`. The later `await clearWorktree` stays. Clearing first would drop the outgoing draft's checkout. Waiting only on the async clear leaves a window where the next draft copies the previous worktree.

13. **`applyPendingWorktree` reads the session first.** `local` and `existing` return immediately and do not read the mirror. `create` uses the session's fields. A null selection still falls through to the mirror, and an unknown mirror mode is passed through: `in-place` must not be rewritten as `branch`. After a successful create, the selection becomes `{ kind: 'existing' }`.

14. **Workdir actions write the session beside the mirror setters.** There is no subscriber that copies the mirror onto the focused session. The file-tree cache still follows the focused session after that session is already active (decision 8).

15. **Both chips read `useComposerLocation()`.** `readOnly` is the existing started-session signal: a host session, or any message. The branch chip treats `pendingCreate` or an `existing` selection as a worktree, so it stays hidden while a create is pending. Git IPC uses `location.cwd`.

16. **The environment control is a dropdown.** It is hidden unless multi-host chrome is on and at least two environments are listed. Offline wins. A project that is not a git repo, or a checkout with no origin, disables the other rows with the not-a-git-repo label: a checkout with no origin cannot be cloned. A missing checkout of the same origin is Clone Here. Needs-upgrade stays selectable and shows a badge. Choosing an environment focuses that checkout's project root and sets `{ kind: 'local' }`. Clone uses `git.clone` with `ifExists: 'reuse-or-rename'`. The local parent is `defaultClonePaths[connectionId]` or `~/SuperOne/Projects`. A remote clone passes an empty parent so the node uses its projects directory.

17. **`clearWorktreeMirror` only resets the file-tree cache.** It does not activate a worktree or mint a session.

18. **Tracking refs stay a separate list.** Selecting `origin/x` checks out local `x`. The local branch is created with `--track origin/x` only when `x` does not already exist. The checkout command is never `git checkout origin/x`. A name with no slash (`origin`) and `origin/HEAD` are dropped. They are the remote's symbolic HEAD, not branches.

19. **Fetch always uses the remote name `origin`.** There is no remote picker. A worktree lists branches with that worktree as `cwd`. Fetch updates the shared object database of the project that owns the path, including when the path is a worktree that is not its own project. Fetch and the tracking list are git features, so they stay visible with only this machine.

20. **`git.init` is a node method.** Desktop `GIT_INIT` on a `remote:` key opens the project if needed and calls it. A folder that is already a repository is a no-op. The phone allowlist does not gain `git.init`. An old node that lacks the method surfaces the existing init-failed toast.

## Phases

### 1. Data layer

- Per-environment project catalog with loading and error, no auto-dial.
- Lazy session pages keyed by `ProjectRef` (`environmentId:projectId`).
- Persisted group-by, sort and expanded keys.
- `installationProfile` → local / CLI node / remote desktop.
- New sidebar code routes with `ProjectRef` and keeps the legacy path key only at the `selectProject` boundary.

### 2. Sidebar

- Project mode merges by normalized `repoIdentity` into a header plus one `ProjectSidebarRow` per checkout (decision 9). Environment mode nests environment → project → session.
- Session hover card from list data only. No RPC on hover.
- Offline rows dimmed, with a disconnected icon. Power and refresh sit on the environment header.
- Host filter removed. Group-by tabs appear only when multi-host chrome is on. With the flag off, a selected remote host still has its refresh and power buttons.

### 3. Workdir picker

- Environment dropdown at the top of the popover, default this machine.
- Selectable, needs-upgrade, clone-here, and disabled states. Clone uses `git.clone` into the node's projects directory when the caller passes no parent.
- `{ environmentId, selection }` lives on the session and the draft.
- Both chips read one selector.
- A started session's popover is read-only for the environment. Worktrees do not cross environments.
- Regression: a new session created while the focused session is in a worktree starts at the project root, including when `clearWorktree` is slow.

### 4. Branches

- Remote branch listing passes `cwd`, including a worktree that is not its own project.
- Remote-tracking refs are a separate list. Fetch uses `git.fetch` on `origin`. Picking `origin/x` checks out local tracking branch `x` (decision 18).
- `GIT_INIT` accepts a remote path and calls `git.init` (decision 20).
- The branch chip uses `GitBranchMenu`. The workdir create-from list shows the same `{ local, tracking }` lists. Selecting a tracking ref there sets the pending base to `origin/x` and does not check the ref out.

## Progress

| Phase | Status | Verification |
|---|---|---|
| Proposal copied | done | `9c893f67d` |
| Plan | done | `75728fd9d` |
| 1 Data layer | done | `bunx vitest run` from `apps/desktop`: catalog 11, `use-sidebar-sessions` 6, `AppSidebarRefresh` 2, `AppSidebar` 29, all passed. `typecheck:web` and `typecheck:node` still fail on existing errors outside this change (`ChatStatusBar.stories.tsx` `GitDirtyStatus` null, `packages/shared/src/transcript-boundary.ts` TS2532). |
| 2 Sidebar | done | `bunx vitest run` from `apps/desktop`: catalog 11, session-hover 1, `use-sidebar-sessions` 6, `ProjectSidebarRow` 16, `SessionRow` 3, `AppSidebarRefresh` 2, `AppSidebar` 30, all passed (69). `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. |
| 3 Workdir | done | `bunx vitest run` from `apps/desktop`: session-location 4, composer-location 4, work-dir-environment 5, draft-promote 26, draft-promote-live-store 4, reset-session-worktree 2, session-lifecycle 43, session-turn 25, send-message 66, switch-session-worktree-root 1, chat-store-actions reset/worktree 7, all passed. `apps/mobile` `remote-draft-codec` 3 passed. `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. |
| 4 Branches | done | `bunx vitest run` from `apps/desktop`: git-branch-lists 3, remote-file-tree 36, ReviewPanel 1, all passed. `bunx vitest run` from `packages/runtime`: branch-refs 5, git-branch-service 2, rpc-dispatch 35, all passed. `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. Stories: `GitBranchMenu.stories.tsx` (branches, fetching, fetch error, loading, empty, long names, narrow, dark). |

## Blockers

None yet.

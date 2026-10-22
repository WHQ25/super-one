# Multi-host sidebar

Status: branch changes are behind `experimentalRemoteNodesEnabled`; long-term doc move still open · Updated: 2026-10-22
Goal: One desktop window lists and starts sessions on every connected environment, and a new session owns its worktree instead of copying the focused session's.
Proposal: [multi-host-sidebar.md](../proposals/multi-host-sidebar.md)
Long-term docs affected: [remote-node-service.md](../architecture/remote-node-service.md)

## Decisions

Open questions from the proposal, settled here.

1. **Merged-project actions name the environment in a submenu.** Rename, remove and edit-extra-dirs on a row that merges several checkouts open a submenu of `environment · path`. One checkout keeps today's single action. A merged row has no single path, and a second dialog would hide which machine is about to change.

2. **`repoIdentity` stays the normalized `origin` URL.** Forks with a different origin stay separate projects. Extra remotes do not join the group. That is already what `ProjectSnapshot.repoIdentity` and [remote-node-service.md](../architecture/remote-node-service.md) §14.3 mean by "the same repository". Changing the identity would be a registry migration, not a sidebar change.

3. **Pinned sessions and drafts stay one flat list.** The environment shows up in the session hover card, and on the row only when that environment is offline. Grouping this short list by the sidebar mode would split pins the user expects to stay together. The proposal already says a session row does not name its environment.

4. **Multi-host chrome stays behind `experimentalRemoteNodesEnabled`.** The flag off, or the flag on with only this machine, keeps today's single-host sidebar: a "Projects" label, local projects, no environment group-by, no environment dropdown. The global host filter is removed in both cases. It was already hidden while the flag was off.

5. **One chip.** The design session merged the workdir and branch indicators after the proposal's first chip sentence. The status bar has a single chip, including when only this machine is connected. Its popover is the environment row, then Local / Worktree tabs, then a search field whose hint follows the tab. Hovering the environment row opens a submenu of devices when more than one is connected. A worktree base can still be a new branch, an attach, or a detach. Remote-tracking refs and Fetch are not shown. There is no second branch chip. A pending create stays on this chip instead of hiding a sibling. Decision 21 records the labels.

6. **The sidebar does not dial every paired node.** Project lists load only for `connected` and `needs-upgrade` environments. `desired: false`, offline, disconnected, and connecting buckets stay empty with an offline or connecting header. A loading write keeps the checkouts already on screen until that environment settles; the settled bucket replaces them. Offline pins and drafts use the connection id, not a retained checkout list. Auto-connecting each host on mount would undo an explicit disconnect.

7. **A remote with no `installationProfile` is a CLI node.** Remote desktops set `local-electron`. Headless installs set `systemd-user`, `nohup`, and the other CLI profiles. Behaviour is the same; only the icon differs.

8. **The file-tree root may still cache the focused session.** `useAppStore._worktrees` cannot be deleted outright: the app store cannot import the chat store synchronously, and the file tree reads that map. New sessions and drafts never read it. The session's own `{ environmentId, selection }` is the source. The map is updated from the focused session after that session is already active, and it is cleared in the same synchronous turn that a new session becomes active.

9. **A merged repository is a header plus one row per checkout.** Superseded for project mode by decision 21. `ProjectSidebarRow` still binds every session to `folder.path`, so the merged header does not own the sessions itself. Each checkout keeps its own row component, with the folder header hidden, and the sessions render as one flat list. The header key is `group:${mergeKey}` and its edit and remove actions are the submenu from decision 1. A repository with one checkout stays a single row. `collapsedEnvironmentIds` is stored instead of an expanded list: empty means every environment starts open, and nothing has been released with the old key.

10. **The session owns the checkout.** `worktreeHintForSession` and `snapshotDraftSettings` read `_worktreePath` and `environmentSelection`. They do not copy `_worktrees[project].activePath` onto a session whose path is null. Tests that required that copy now expect null.

11. **`environmentSelection` stays optional.** Existing session literals and reloaded rows have no column for it. `createDefaultPerSessionState` leaves it null, and a null selection still falls through to the file-tree cache so in-flight sessions keep working. New Session stamps `selectionForNewSession` with the connection id on the project route (`local`, or the remote connection id). After the user picks an environment, the stored id is the catalog environment id. A reloaded session with a null selection plus `_worktreePath` is treated as an existing checkout.

12. **Clear the mirror after the outgoing draft is saved, and before the active session changes.** `resetSessionImpl` awaits `promoteDraftIfUnsent`, then calls `clearWorktreeMirror`, then switches `_activeSessionId`. The later `await clearWorktree` stays. Clearing first would drop the outgoing draft's checkout. Waiting only on the async clear leaves a window where the next draft copies the previous worktree.

13. **`applyPendingWorktree` reads the session first.** `local` and `existing` return immediately and do not read the mirror. `create` uses the session's fields. A null selection still falls through to the mirror, and an unknown mirror mode is passed through: `in-place` must not be rewritten as `branch`. After a successful create, the selection becomes `{ kind: 'existing' }`.

14. **Workdir actions write the session beside the mirror setters.** There is no subscriber that copies the mirror onto the focused session. The file-tree cache still follows the focused session after that session is already active (decision 8).

15. **The status-bar chip reads `useComposerLocation()`.** `readOnly` is the existing started-session signal: a host session, or any message. `pendingCreate` is any `selection.kind === 'create'`. Branch switching on the checkout tab uses the project checkout. The active worktree's git status uses `location.cwd`.

16. **The environment control is a dropdown.** The environment row always shows, including with the flag off or with only this machine; the name then falls back to This Mac or This PC. Hovering it opens the device submenu only when at least two environments are listed. Row order is offline, current, not-a-git-repo, no-origin, clone-here, then needs-upgrade. Offline wins, including when the current environment itself is offline. A project that is not a git repo disables the other rows with Not a Git Repository. A checkout with no origin disables them with No Origin: it cannot be cloned, and that is a different reason from not being a repository. A missing checkout of the same origin is Clone Here. Needs-upgrade stays selectable and shows a badge. Choosing an environment that has no checkout shows an error and leaves the popover open. Choosing one that has a checkout focuses that checkout's project root and sets `{ kind: 'local' }`. Clone uses `git.clone` with `ifExists: 'reuse-or-rename'` on both the local host and the node: the same normalized origin reuses the folder, otherwise the clone goes beside it as `name-2`, `name-3`. The local parent is `defaultClonePaths[connectionId]` or `~/SuperOne/Projects`. A remote clone passes an empty parent so the node uses its projects directory.

17. **`clearWorktreeMirror` only resets the file-tree cache.** It does not activate a worktree or mint a session.

18. **No remote-tracking refs in the desktop picker.** Decisions 5 and 21 removed them from the popover, and the branch review settled that the unused plumbing is deleted rather than kept for later (D1). The checkout tab and the worktree create-from list show local branches only. A local branch is never created from `origin/x` by this UI.

19. **No Fetch in the desktop picker.** The node's existing `git.fetch` method stays for the collaboration path. The desktop IPC route and the renderer helpers added for the picker are deleted (D1). A worktree still lists branches with that worktree as `cwd`.

20. **`git.init` is a node method.** Desktop `GIT_INIT` on a `remote:` key opens the project if needed and calls it. A folder that is already a repository is a no-op. The phone allowlist does not gain `git.init`. An old node that lacks the method surfaces the existing init-failed toast.

21. **The prototype decides structure. Existing components decide the look.** Group-by is a dropdown beside the Projects label, with a check on the current mode. It is not a tab strip, and it still appears only when multi-host chrome is on. Project mode with several checkouts is one project header and one flat session list. The environment stays on the hover card. The header's new-session action targets the local checkout, or the most recently opened checkout when this machine has none. Opening the header loads each checkout's sessions. Environment mode stays environment, then checkout, then sessions. While multi-host chrome is on, every project row is chevron, folder, name, and a new-session button that stays visible. Search, automations, and mini-apps stay on the single-host row. The status bar has one chip, including with the flag off. The name falls back to This Mac or This PC. The label is the checkout branch, the worktree branch, New Worktree ← base, or Git Not Initialized. The icon after the dot is the branch icon on a checkout and the worktree icon on a worktree. The popover keeps the workdir and branch actions in one chip. The environment row is always first, including when only this machine is connected, and it does not say Environment. Hovering the environment row opens a device submenu when more than one device is connected. The sidebar group-by stays behind multi-host chrome. The tabs are Local and Worktree. Local is the default when the selection is local. The popover opens on the tab that matches the current selection, so a pending or existing worktree opens on Worktree (C14). The search field sits under the tabs. On Local it searches and creates branches. On Worktree it searches worktrees. A folder that is not a repository disables the Worktree tab and offers Initialize Git on {environment}. The checkout tab lists local branches and New Branch…, without a path row or a local-branches heading. Clicking a branch runs the existing checkout on the shared project. Switching to the checkout tab clears a pending create. The worktree tab lists existing worktrees, then Create From local branches. Picking a base starts a branch-mode create and shows New branch, Attach, and Detach, plus the branch-name field, the carry checkbox when the checkout is dirty, and the hint that the worktree is created on the next message. Remote-tracking refs and Fetch are not in this popover. A draft that already names a branch, or uses attach or detach, still activates that way. A started session marks the environment fixed. On the local checkout it can still switch branches. On a worktree it shows the path and the existing handoff, fork, and assign actions.

22. **Every paired host that reports `nodeUpgrade` is upgraded.** Confirmed by the user on 2026-10-22. There is no selected-host filter. A stale node breaks model discovery and agent turns on that environment even when the user never picked it in a host switcher. Releases are frequent, so the sidebar starts the upgrade for each such host (C18).

23. **An opened phone draft stays on the environment it was saved for.** Confirmed by the user on 2026-10-22. Re-staging merges the phone's current harness and checkout settings, but a saved `environmentId` wins. A saved draft with no `environmentId` does not adopt the routed host, so a desktop draft is not retargeted when the phone is routed. A new draft still records the current route. `selectionFromDraftFields` is unchanged: a missing id is still `local` on the host that stores the draft.

24. **The add-project dialog reports a directory conflict.** Confirmed by the user on 2026-10-22. Cloning from that dialog does not send `ifExists`. A folder that already exists is a conflict on every machine the dialog targets, with the same message as a local clone: pick another folder, or add the existing project. Clone Here on the environment chip still uses `reuse-or-rename` (decision 16). Those are different actions.

25. **This branch's user-visible checkout changes run only while `experimentalRemoteNodesEnabled` is on.** Confirmed by the user on 2026-10-22. This supersedes the parts of decisions 16 and 21 that show the merged status-bar chip, including with the flag off. With the flag off, the status bar keeps the pre-branch worktree chip and the separate branch chip, and git status stays on the open project folder. A new session does not take ownership of the checkout: it does not clear the file-tree mirror early, it does not stamp `environmentSelection`, and a pristine session with only a pending mirror create is left as it was. Send and draft capture follow that mirror. With the flag on, the merged chip shows even when only this machine is connected. Sidebar chrome still needs another host (decision 4). Shared git helpers, the node's `git.fetch`, collaboration clone, the add-project conflict (decision 24), and an opened phone draft staying on its saved environment (decision 23) are unchanged by this gate.

## Phases

### 1. Data layer

- Per-environment project catalog with loading and error. Only connected and needs-upgrade hosts are dialed, in parallel, each with a timeout (decision 6).
- Sessions stay on the path key. `ProjectRef` is the catalog identity on a checkout, not the session-page key. The unused session-page store is deleted (P1).
- Persisted group-by, sort and expanded keys. The expansion cap keeps the newest 200 keys.
- `installationProfile` → local / CLI node / remote desktop.

### 2. Sidebar

- Project mode merges by normalized `repoIdentity` into one header and a flat session list (decision 21). Environment mode nests environment → project → session.
- Session hover card from list data only. No RPC on hover.
- Offline rows dimmed, with a disconnected icon. Power and refresh sit on the environment header.
- Host filter removed. Group-by is a menu beside the Projects label and appears only when multi-host chrome is on (decision 21). With the flag off, a selected remote host still has its refresh and power buttons.

### 3. Workdir picker

- Environment dropdown at the top of the popover, default this machine.
- Selectable, needs-upgrade, clone-here, and disabled states. Clone uses `git.clone` into the node's projects directory when the caller passes no parent.
- `{ environmentId, selection }` lives on the session and the draft.
- The status-bar chip reads one selector.
- A started session's popover is read-only for the environment. Worktrees do not cross environments.
- Regression: a new session created while the focused session is in a worktree starts at the project root, including when `clearWorktree` is slow.

### 4. Branches

- Remote branch listing passes `cwd`, including a worktree that is not its own project.
- `GIT_INIT` accepts a remote path and calls `git.init` (decision 20).
- The checkout tab uses `GitBranchMenu`. It and the worktree create-from list show local branches only. Tracking refs and Fetch are not part of the picker (decisions 18 and 19).

## Progress

| Phase | Status | Verification |
|---|---|---|
| Proposal copied | done | `9c893f67d` |
| Plan | done | `75728fd9d` |
| 1 Data layer | done | `bunx vitest run` from `apps/desktop`: catalog 11, `use-sidebar-sessions` 6, `AppSidebarRefresh` 2, `AppSidebar` 29, all passed. `typecheck:web` and `typecheck:node` still fail on existing errors outside this change (`ChatStatusBar.stories.tsx` `GitDirtyStatus` null, `packages/shared/src/transcript-boundary.ts` TS2532). |
| 2 Sidebar | done | `bunx vitest run` from `apps/desktop`: catalog 11, session-hover 1, `use-sidebar-sessions` 6, `ProjectSidebarRow` 16, `SessionRow` 3, `AppSidebarRefresh` 2, `AppSidebar` 30, all passed (69). `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. |
| 3 Workdir | done | `bunx vitest run` from `apps/desktop`: session-location 4, composer-location 4, work-dir-environment 5, draft-promote 26, draft-promote-live-store 4, reset-session-worktree 2, session-lifecycle 43, session-turn 25, send-message 66, switch-session-worktree-root 1, chat-store-actions reset/worktree 7, all passed. `apps/mobile` `remote-draft-codec` 3 passed. `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. |
| 4 Branches | done | `bunx vitest run` from `apps/desktop`: git-branch-lists 3, remote-file-tree 36, ReviewPanel 1, all passed. `bunx vitest run` from `packages/runtime`: branch-refs 5, git-branch-service 2, rpc-dispatch 35, all passed. `typecheck:web` and `typecheck:node` still fail only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. Stories: `GitBranchMenu.stories.tsx` (branches, fetching, fetch error, loading, empty, long names, narrow, dark). |
| Widget structure | done | One status-bar chip: environment, then Local Checkout / Worktree, then branches or worktrees (decisions 5 and 21). `bunx vitest run` from `apps/desktop`: WorkDirIndicator 6, ChatStatusBar 32, work-dir-environment 5, all passed. `typecheck:web` still fails only on the existing `ChatStatusBar.stories.tsx` `GitDirtyStatus` null errors and `packages/shared/src/transcript-boundary.ts` TS2532. Stories: `WorkDirIndicator` `CheckoutBranches`, `WorktreeList`, `EmptyWorktrees`, `NotARepo`, `Chip`. |
| Branch review | fixes in the working tree | Review of `main...711c28231` applied on 2026-10-22. Targeted vitest: from `apps/desktop`, 7 files / 114 tests (catalog 15, work-dir-environment 6, git-branch-lists 2, app 47, reset-session-worktree 4, remote-file-tree 37, shared git-clone 3); from `packages/runtime`, 40 tests (branch-refs 3, git-branch-service 2, rpc-dispatch 35); from `apps/mobile`, remote-draft-codec 4. Storybook stories were added and not executed. `typecheck:web` and `typecheck:node` were not re-run; the known failures on `main` are unchanged by this pass. The long-term doc move is still open. |
| Review round 2 | fixes in the working tree | R1–R4, the still-open C3/C6/C10/C11/C15/P2 items, catalog timeout, branch helpers, and parallel worktree probing are fixed. The add-project dialog keeps the local conflict (decision 24): it sends no `ifExists`. An opened phone draft stays on its saved environment (decision 23). Targeted vitest passed, including catalog 19, git-clone 10, remote-file-tree 38, reset-session 5, WorkDirIndicator 8, the catalog hook, and the local `reused` host test. Mobile `draft-stage-settings` 3 and `use-remote-drafts` 4 passed. Storybook was not executed. |
| Experiment gate | in the working tree | Decision 25. The merged chip, session-owned checkout, and mirror-free draft capture run only while `experimentalRemoteNodesEnabled` is on. Flag off keeps the pre-branch worktree chip, the separate branch chip, and mirror-backed send and drafts. `bunx vitest run` from `apps/desktop`: WorkDirIndicator 9, ClassicBranchChip 2, reset-session-worktree 7, session-turn 26, draft-promote 27, draft-promote-live-store 5, session-lifecycle 43, chat-store-actions 71, all passed (190). Storybook was not executed. |

## Review findings

Fixed in the working tree on 2026-10-22. Decisions 6, 16, 21 and 22 record C5, C12, C14, C15 and C18. P1 deletes the unused session-page store and keeps path-key routing. The notes below are the first review as filed. What is still open after the fixes is listed in Review round 2.

Line numbers are from `711c28231`. Function names are given so the references survive edits.

### Decided

- **D1. Delete the tracking-ref and Fetch plumbing.** Decided 2026-10-22: decisions 5 and 21 are the later design, so decisions 18, 19 and the Phase 4 bullets now say that the picker has no tracking refs and no Fetch. Delete what this branch added for them and has no caller: the `GIT_FETCH` IPC handler (`apps/desktop/src/main/index.ts:3080`), preload `gitFetch` and its type, `remoteGitFetch` and `owningGitProject` (`apps/desktop/src/main/environment/remote-file-tree.ts:966-1006`) and the gateway entry, the `track` argument of `GIT_SWITCH_BRANCH` (`main/index.ts:3146-3156`) and of `handleBranchSelect` (`WorkDirIndicator.tsx:645`), the `startPoint` chain (`rpc-dispatch.ts:1246`, `git-service.ts:242`, `remote-environment-gateway.ts:747`, `remote-worktree.ts:185-187`), `trackingCheckoutPlan` (`packages/runtime/src/git/branch-refs.ts:33-43`), the unused `tracking` parse in `WorkDirIndicator.tsx:491`, and the fetch stories in `GitBranchMenu.stories.tsx`. Use `git diff main...HEAD` to tell new code from code that was already on `main`. The node's `git.fetch` method was already on `main` for the collaboration path, so keep it. Before you remove the `tracking` field from the `git.branches` result, check that no caller reads it, including mobile. Remove the tests that cover only the deleted code.

### Correctness

- **C1 (high). A remote existing worktree is stored as a bare host path.** `handleSwitchToExisting` (`apps/desktop/src/renderer/src/components/chat/WorkDirIndicator.tsx:623-635`) writes `entry.path` into `selection.path`, `_worktreePath` and `cwd`. Remote entries are raw host paths. `getGitInfo(activePath)` (`:448`, `:467`) and `ChatStatusBar.tsx:246` (`gitFolder = location.cwd`) then send that path to the local git handler, which routes only `remote:` keys (`main/index.ts:2967-2975`). Result: the chip of a remote worktree shows a wrong or empty branch and dirty state. `switchToExistingWorktree` (`stores/app.ts:1073-1074`) already wraps the path with `remoteProjectKey`. Apply the same rule in `handleSwitchToExisting`, ideally through one shared helper.
- **C2 (high, confirm first). A mobile draft edit may drop `environmentId`.** `draftWorktreeSettings` (`apps/mobile/src/remote-draft-codec.ts:65-71`) writes `worktreeSelection` but no `environmentId`. `selectionFromDraftFields` (`packages/shared/src/session-location.ts:56`) falls back to `'local'`. If the draft update replaces the stored settings instead of merging them, a remote-project draft edited on the phone is restored on This Mac, and its existing worktree path is attributed to the local machine. Check how the draft RPC applies the partial settings. If it replaces them, carry `environmentId` through the codec.
- **C3 (medium). Local Clone Here ignores `ifExists: 'reuse-or-rename'`.** The local host calls the shared `cloneRepository` (`apps/desktop/src/main/environment/environment-host.ts:2545-2550`; `packages/shared/src/git-clone.ts:91`). That function has no `ifExists` and throws `conflict` when the target folder exists. Only the node path handles reuse, through `existingCloneTarget` (`packages/runtime/src/server/rpc-dispatch.ts:1623`, `:1652`). Scenario: `~/SuperOne/Projects/<repo>` already exists, so Clone Here on This Mac fails. Move the reuse-or-rename logic into the shared clone function and call it from both hosts (decision 16).
- **C4 (medium). One slow node stalls the whole catalog.** `loadEnvironmentCatalog` (`apps/desktop/src/renderer/src/lib/multi-host/catalog.ts:129-142`) awaits each remote `listProjects` in sequence with no timeout. `useLoadMultiHostCatalog` replaces every bucket only after the loop ends. Load the environments in parallel with a per-environment timeout, and write each bucket as it settles.
- **C5 (medium). Connecting environments are dialed.** `catalog.ts:133` skips only `offline`. `connectionOf` (`lib/multi-host/environment-kind.ts:24`) also returns `connecting`, and `listProjects` on a node that is not connected throws `failed_precondition`. A normal reconnect then shows a red retry row (`MultiHostProjectList.tsx:154-167`). This breaks decision 6. Load only `connected` and needs-upgrade environments.
- **C6 (medium). Catalog loads race.** `useLoadMultiHostCatalog` (`components/sidebar/multi-host/use-load-multi-host-catalog.ts:34-71`) starts a load on mount, on every environment-list event and on every host-projects event, with no request sequencing. An older result can overwrite a newer one. The returned `reload` duplicates the effect body and is discarded by `AppSidebar`. Keep one load function with a sequence number, and either use `reload` or remove it.
- **C7 (medium). New Session keeps a pending create on a pristine session.** The early return in `resetSessionImpl` (`stores/chat-store/helpers/session-lifecycle.ts:560-570`) checks `_worktreePath`, but not `environmentSelection.kind === 'create'` or the mirror's `pendingBaseBranch`. Scenario: in a new session, pick Create From `main`, type nothing, then press New Session. The chip still reads `New Worktree ← main`.
- **C8. Closed by D1.** The `--track` path without an existence check is deleted with the tracking plumbing.
- **C9 (medium). Drafts have no offline state.** `DraftsSection.tsx` is unchanged. A draft on an offline node looks live, and resuming it fails with a toast. Decision 3 requires the same dim and disconnected icon as pinned rows (`AppSidebar.tsx` `pinOffline`).
- **C10 (low). Per-environment loading never renders.** `projectsStatus: 'loading'` is never assigned (`catalog.ts:89-100`), so `MultiHostProjectList.tsx:136-138` cannot render. When the catalog load throws, `use-load-multi-host-catalog.ts:46` sets `environments` to `[]` and the sidebar shows Loading… indefinitely.
- **C11 (low). Branch-list failures look like empty lists.** The catch in `getRemoteGitBranches` (`remote-file-tree.ts:~957-962`) and the `GIT_LIST_BRANCHES` catch (`main/index.ts:3076-3078`) return `{ local: [], tracking: [] }`. An offline or timed-out node shows No branches with no error.
- **C12 (low). Offline buckets keep stale checkouts.** `keepOfflineCheckouts` (`use-load-multi-host-catalog.ts:10-17`) keeps the previous checkouts, which contradicts decision 6 ("stay empty"). Either drop them or update decision 6 to say that offline rows keep their last known projects.
- **C13 (low). Offline does not always win.** `work-dir-environment.ts:52-54` checks `isCurrent` before offline, which contradicts decision 16.
- **C14 (low). Default tab.** `WorkDirIndicator.tsx:544` opens the Worktree tab when the selection is not `local`. Decision 21 says Local is the default. Either change the code or record in decision 21 that the tab follows the current selection.
- **C15 (low). UI state left over.** `environmentError` (`WorkDirIndicator.tsx:382`) is not cleared when the environment changes. `switchComposerToCheckout` is called with `void` and no catch (`:574`). The silent `return` at `:580` gives no feedback. A checkout with no origin shows `chat.worktree.notAGitRepo`, which is the wrong reason.
- **C16 (low). The merged header toggle loads a non-path key.** `MultiHostProjectList.tsx:186-188` calls `toggleExpand('group:…')`, which calls `loadFolderSessions` with that key. No RPC is sent, but stray `loadingFolders` and `folderSessions` entries are left behind.
- **C17 (low). The expansion cap keeps the oldest keys.** `sidebar-settings.ts:62-63` keeps the first 200 keys on persist. It should keep the most recent ones.
- **C18 (low). Auto-upgrade scope changed.** `AppSidebar.tsx:417` now upgrades every paired host that reports `nodeUpgrade`, not only the selected host. Confirm that this is intended.

### Phase 1 deliverables not met

- **P1. `ProjectRef` routing.** New sidebar code still routes by path key (`use-sidebar-sessions.ts:81`, `AppSidebar` `folderPath`). `projectRefKey` (`lib/multi-host/group-projects.ts:88`) has no caller. The store's `sessionPages` and the `beginSessionLoad`, `commitSessionPage` and `failSessionPage` actions (`stores/multi-host-sidebar.ts:10`, `:48-58`; `lib/multi-host/session-pages.ts`) have no UI caller. Either move the lazy session pages onto them, keyed by `environmentId:projectId`, or delete them and rewrite the Phase 1 bullets.
- **P2. Dead selector state.** The `visible` value from the environment hook (`work-dir-environment.ts:78`) is unused, because `WorkDirIndicator.tsx:796` hard-codes it. `loading` is always false (`:80`). Remove them, or wire `loading` into the menu.

### Cleanup (DRY and performance)

- `main/index.ts:3063-3075` reimplements `WorkspaceGitService.branches()`, and `:3149-3156` reimplements `switchBranch`. `readBranchLists` (`components/chat/git-branch-lists.ts:9-18`) duplicates `branchListsOf` (`remote-file-tree.ts:~910-914`).
- `SessionHoverCard.tsx:9-13` duplicates `EnvironmentKindIcon` (`EnvironmentSectionHeader.tsx:8-12`).
- `ProjectSidebarRow.tsx:686-702` calls `sessionPresentation` twice per row and rebuilds the hover model on every render, so `memo(SessionRow)` never bails out. Memoize the hover model per session.
- For a worktree path, `getRemoteGitBranches` and `owningGitProject` (`remote-file-tree.ts:~945-955`, `:978-987`) probe every project in sequence, one RPC each. Resolve the owning project once.

### Coverage gaps

- Stories: `MultiHostProjectList` (merged, environment mode, offline, error, empty) and `PinnedSessionRow` (offline) have none. `WorkDirIndicator.stories.tsx` has no story for a pending-create chip, a started-worktree chip, or a narrow layout.
- Tests: `MultiHostProjectList`; offline pins and drafts; the multi-host sidebar store actions; local reuse-or-rename clone; `environmentId` through the mobile draft codec; the remote switch-to-existing path (C1); `remoteGitInit`; the `GIT_INIT` and `GIT_SWITCH_BRANCH` IPC handlers; the `getRemoteGitBranches` error path; `git.init` denied without `writeWorkspace`.

### Out of scope (already on `main`)

- `checkout <name>` without `--` (`git-service.ts:245`, `main/index.ts:3154`) treats a name that matches a tracked file and no branch as a pathspec, and restores that file. The phone can reach it through `git.switchBranch`. Switching to `git switch` would remove the ambiguity. Track it as its own change.

### Wrap-up still required

- When the fixes land, move what stays true (group-by modes, the shared `{ environmentId, selection }` contract, the chip's selector, `git.init`) into [remote-node-service.md](../architecture/remote-node-service.md) §14.3 or the desktop manual. Then delete this plan and the accepted proposal in the same change.

## Review round 2

Fixed in the working tree on 2026-10-22. The phone-draft item was decided the same day: an opened draft stays on its saved environment (decision 23). The add-project dialog keeps the directory conflict (decision 24). Decision 6 now says a loading write keeps the checkouts already on screen. The notes below are the review as filed.

Second review of the uncommitted fixes on 2026-10-22, against the working tree on top of `711c28231`. Targeted vitest passed: `apps/desktop` renderer 28 files / 345 tests, `apps/desktop` main and shared 40, `packages/runtime` 123, `apps/mobile` `remote-draft-codec` 4. `typecheck:web` and `typecheck:node` show only the known errors that are also on `main`. Line numbers are from the working tree at review time. Function names are given so the references survive edits. Fix each item and add a test for each behaviour fix. Do not rewrite a decision to match the code without asking the user.

### Regressions from the fixes

- **R1 (high). Every catalog reload blanks all project rows.** `loadProjects` (`apps/desktop/src/renderer/src/lib/multi-host/catalog.ts:137`) emits a `loading` bucket with `checkouts: []`. `upsertBucket` (`components/sidebar/multi-host/use-load-multi-host-catalog.ts:12-20`) replaces the stored bucket with it. Every reload therefore removes every project row until each RPC returns, which can take up to the 12 s timeout. Reloads run on a new `recentFolders` array, on every environment-list event and on every host-projects event. The hook's comment says "The list is not cleared at the start", which the code contradicts. `multi-host-catalog.test.ts:278` checks only the status strings. Keep the previous checkouts on the loading write (stale-while-revalidate), and add a test that asserts the checkouts survive a reload.
- **R2 (medium). The C7 fix leaves an orphan empty session.** `resetSessionImpl` (`stores/chat-store/helpers/session-lifecycle.ts:555-566`) now treats a pending create as not pristine and falls through to mint a new session. The old empty session stays in `_sessions` with its `create` selection, so Ctrl+Tab shows a duplicate New session, and going back to it shows `New Worktree ← main` again. The new test (`reset-session-worktree.test.ts:88-104`) asserts `_activeSessionId !== 'fresh'`, which locks this in. When the session is otherwise pristine, reuse it instead: reset its selection to `{ kind: 'local' }` and clear the mirror. Change the test to assert that one session remains, with a local selection.
- **R3 (medium). Reuse-or-rename does not reuse a numbered clone.** `planCloneTarget` (`packages/shared/src/git-clone.ts:96-99`) checks only whether `name-n` exists, not its origin. Scenario: `~/SuperOne/Projects/app` has a different origin, so the first clone lands in `app-2`. The next clone of the same repository lands in `app-3` instead of reusing `app-2`. Check each candidate for a matching origin before taking the first free name.
- **R4 (medium). Deleted clone tests.** The fix removed the `buildCloneArgs` and `parseCloneProgress` tests from `packages/shared/src/git-clone.test.ts`. Both functions are still used (`git-clone.ts:27`, `:52`). Restore the tests.

### Still open from the first review

- **C3, local `reused`.** The local host returns `registerLocalProject(...)` and drops `reused` (`apps/desktop/src/main/environment/environment-host.ts:2546-2550`). This breaks the clone result contract (`events.ts:228`). `collaboration-remote.ts:283` (`cloned = !clone.reused`) then skips the fetch for a reused local checkout. Return `reused`.
- **C3, enclosing repository.** `originUrl` (`git-clone.ts:69-79`) runs `git -C <dir> config`, which finds an enclosing repository. A plain folder inside a repository with a matching origin is reused as if it were a checkout. Reuse the folder only when `git rev-parse --show-toplevel` is that folder.
- **C3, add-project dialog.** Decided 2026-10-22: keep the conflict (decision 24). Filed note: `use-add-project-dialog.ts:918` sends no `ifExists`. Decide with the user whether that dialog should reuse as well. Until then, leave it unchanged.
- **C6, manual refresh.** `refresh-environment.ts:5-16` writes buckets without the generation ticket. A manual refresh that resolves after a newer catalog load overwrites fresher data. Use the same ticket.
- **C10, error row.** `MultiHostProjectList.tsx:154-163` shows the raw `projectsError` as the button label, untranslated (for example "timed out"), with no clear retry affordance. Use a translated label with retry, and put the raw message in a tooltip.
- **C11, missing `local`.** `main/index.ts:3062` returns `{ error: 'not a remote project' }` without `local`, which the preload type requires. Return `{ local: [], error }`.
- **C15, invisible error.** `WorkDirIndicator.tsx:580` closes the popover before the async environment switch, so its failure sets an error that the user cannot see. The error is cleared only when `environmentId` changes (`:384-386`), so it shows again on the next open. Keep the popover open until the switch succeeds, or report the failure with a toast, and clear the error when the popover opens.
- **Decision 16, flag off.** With the flag off, `useLoadMultiHostCatalog` clears the catalog (`use-load-multi-host-catalog.ts:46-47`). `WorkDirEnvironmentMenu` then returns null when it has no options. Decisions 16 and 21 say the row always shows, with This Mac or This PC. Render the local row when the catalog is empty.
- **P2.** `WorkDirEnvironmentMenu` still takes `visible` and `loading` props, and `WorkDirIndicator` passes `visible` as a literal. Remove `visible`. Remove `loading` too, unless the catalog's loading state is wired into it.
- **Cleanup, main duplication.** `GIT_LIST_BRANCHES` still runs `git branch` through `gitRun` (`main/index.ts:3063-3064`), and `GIT_SWITCH_BRANCH` still runs `checkout` directly (`:3121`). Both should go through the shared runtime git service or helpers.
- **Cleanup, worktree probing.** `branchOwnerByPath` (`remote-file-tree.ts:90`, `:953-968`) caches only successful lookups. The first lookup still probes each project in sequence (`:971-980`).
- **Catalog timeout.** `listItems` has no timeout (`catalog.ts:172`). A timed-out `listProjects` is not cancelled (`:25`, `:106`), so each reload adds another pending RPC for a stuck node. A local `listProjects` timeout silently falls back to recent folders without `repoIdentity`. At least time out `listItems`, and do not start a second request for an environment that already has one in flight.
- **Coverage, tests.** Still missing: `MultiHostProjectList`; offline pins and drafts; a hook test for the loading and stale states (R1); the `WorkDirIndicator` switch-to-existing handler for a remote worktree (C1, the store test does not cover the component); `remoteGitInit`; the `GIT_INIT` and `GIT_SWITCH_BRANCH` IPC handlers; `git.init` denied without `writeWorkspace`; the mobile draft round trip with `environmentId`.

### Needs a decision

- **Phone draft environment.** Decided 2026-10-22: an opened draft stays on the machine it was saved for (decision 23). Filed note: `use-remote-drafts.ts:52` merges `{ ...saved.settings, ...o.settings }`, so an opened draft keeps its saved `environmentId` even after the phone is routed to another host. On that host, `'local'` then resolves to node X through `session-location.ts:56`.

### Wrap-up still required

- `MultiHostProjectList.stories.tsx` and `PinnedSessionRow.stories.tsx` are untracked. Add them in the commit.
- [remote-node-service.md](../architecture/remote-node-service.md) §14.3 now covers the selection contract, the local-only branch picker, `git.fetch` and catalog dialing. It still lacks the group-by modes, the chip's `useComposerLocation` selector and `git.init`. Fix its `ifExists` parity claim after R3 and the C3 `reused` fix. Then delete this plan and the accepted proposal in the same change.

## Blockers

None. The long-term doc move is still open.

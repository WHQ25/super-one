# Multi-host sidebar, workdir and branch pickers

Status: accepted · Updated: 2026-10-22
Plan: [multi-host-sidebar.md](../plans/multi-host-sidebar.md)

Scope: let one desktop window see and start sessions on every connected
environment (this machine, CLI remote nodes, remote desktops) without switching
a global host. Covers the session sidebar, the composer's workdir indicator and
the branch indicator. Mobile is out of scope, apart from the shared selection
contract below.

Interactive prototype: SuperOne widget template
`multi-host-sidebar-prototype-834855ea` (project scope; render it with
`widget_show({ template: "multi-host-sidebar-prototype-834855ea" })`). The
template lives in the main checkout's gitignored `.superone/alpha/widget/`.
It is the reference for the layout and the interaction states described here.

## Today

- The sidebar shows one host at a time. The host dropdown in
  `AppSidebar.tsx` is a global filter: it swaps projects, pinned sessions,
  drafts, `currentFolder` and provider scope, and it is hidden unless
  `experimentalRemoteNodesEnabled` is on.
- Projects and sessions are routed by the string key
  `remote:<connectionId>:<hostPath>` (`packages/shared/src/remote-resource-key.ts`),
  not by `ProjectRef {environmentId, projectId}`.
- `WorkDirIndicator` and the branch indicator in `ChatStatusBar` already work
  on a remote project, but only for the host of `currentFolder`.
- `ProjectSnapshot.repoIdentity` exists. The intended UI grouping
  (`docs/architecture/remote-node-service.md` §14.3) is not implemented.
- Sort mode and expanded state are React state only.

## Decisions

### Sidebar

1. **Two group-by modes, persisted.** These are *project* (the default) and
   *environment*. The sidebar menu switches between them. Sort and expanded
   state are persisted too. The global host dropdown is removed.
2. **Project mode merges checkouts by `repoIdentity`.** One project row
   aggregates the checkouts of the same repository on every environment.
   Folders without a git remote, and folders that are not git repositories,
   stay one project per `(environment, path)`.
3. **Environment mode nests environment → project → session.** The environment
   header carries connection state (connecting, offline, needs upgrade). A
   project that has no sessions on that environment shows an empty row.
4. **Session rows do not name the environment.** The row shows only abnormal
   environment state: a session on an offline environment is dimmed and shows a
   disconnected icon.
5. **Session hover card.** Hovering a session title opens a card built on
   `packages/ui` `hover-card`. It shows:
   - environment: icon, name, kind and state
   - location: checkout or worktree path
   - branch
   - harness
   - status and last activity
   - parent/subagent relations and the "started from <A>" controller
   - tags

   It renders only data already present in the session list. Hovering never
   issues an RPC.
6. **Distinguish CLI nodes from remote desktops.** Use `installationProfile`
   for this. The two get different icons; behaviour is identical.

### Workdir indicator

1. **One status-bar chip.** It reads `environment · branch` on the local
   checkout (`本机 · ⎇ main`), `environment · worktree branch` on an existing
   worktree, `environment · New Worktree ← base` while a create is pending, and
   `environment · Git Not Initialized` when the folder is not a repository.
   The popover is environment, then mode tabs (local checkout by default, or
   worktree), then that mode's content. Returning to the checkout tab clears a
   pending create. The plan's decision 5 records this merge.
2. **An environment dropdown sits at the top of the popover.** It defaults to
   this machine. Picking an environment swaps all data below it. Below that,
   tabs split local checkout (path and branches) from worktree (existing
   worktrees and create-from). Each environment in the dropdown is in one of four states:
   - selectable
   - selectable, needs upgrade
   - *clone here* (has a `repoIdentity` but no checkout on that environment;
     uses `git.clone`, then selects the environment)
   - disabled (offline, or the project is not a git repository)
3. **Pending selection is `{ environmentId, selection }`.** `selection` reuses
   mobile's `NewSessionWorktreeSelection` (`local` | `existing` | `create`), and
   this becomes the shared contract. The renderer's pending worktree state is
   keyed by project *and* environment, not by `projectPath`.
4. **The environment is fixed once a session has started.** A session on the
   local checkout can still switch branches from the same popover. A session on
   a worktree shows its path plus the existing in-environment handoff, fork, and
   assign actions. Worktrees never cross environments.

### Branches inside the chip

1. Branches come from the selected environment and cwd, not from the global
   host. `getRemoteGitBranches` must pass `cwd`.
2. Remote-tracking refs (`refs/remotes/*`) are listed on the checkout tab, with
   a fetch action backed by `git.fetch`. Picking `origin/x` checks out a local
   tracking branch `x`. The worktree tab's create-from list includes the same
   refs and does not check them out.
3. `GIT_INIT` gains a remote path. A folder that is not a repository shows that
   action on the checkout tab.
4. A pending worktree create is the same chip's worktree label. It does not
   hide a second indicator.

### Shared selector

The chip reads one selector that resolves `(environment, cwd, branch)` from
either the active session or the pending new-session selection. It does not
derive that context from `currentFolder` on its own. Branch switching on the
checkout tab still targets the project checkout.

## Phases

1. **Data layer.**
   - A multi-host project and session store, with loading and error state per
     environment.
   - Sessions load lazily per `(environment, project)` when expanded, and the
     per-environment pages are merged.
   - `ProjectRef` progressively replaces the `remote:` key in the renderer.
   - Sidebar settings are persisted.
2. **Sidebar.** Group-by modes, the hover card, offline row state, and removal
   of the host filter.
3. **Workdir picker.** The environment dropdown, the shared selection contract
   and the shared selector.
4. **Branches.** Pass `cwd`, list remote-tracking refs, add fetch, add remote
   init.

## Open questions

- Actions on a merged project (rename, remove, edit extra dirs) must name the
  target environment. Should they move into a per-environment submenu?
- Repositories with several remotes, or forks: which remote defines
  `repoIdentity` for merging?
- Pinned sessions and drafts: one merged list with environment shown only in
  the hover card, or grouped like the sidebar mode?
- Do the redesigned sidebar and picker ship behind
  `experimentalRemoteNodesEnabled`? With only this machine connected they
  degrade to today's single-host UI.

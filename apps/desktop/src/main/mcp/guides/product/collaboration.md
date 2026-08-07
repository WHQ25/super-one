# SuperOne — agent collaboration (session_collab_*)

Use this before launching child agents with `session_collab_request` / `session_collab_start`, especially when children need **git worktree isolation** or when one child must review another child's branch.

## Flow (short)

1. `session_collab_list_agents` — pick `agentId` profiles.
2. `session_collab_request` — one or more launches (`name`, `role`, `task`, optional `config`).
3. User approves in the UI → you get a **private credential** per launch.
4. `session_collab_start` with each credential (can start several back-to-back; do not wait for one to finish before starting the next).
5. `session_collab_send` / `session_collab_retrieve` for mailbox handoffs (Markdown). Delivery is push-based: end your turn to wait; a wake notification starts a new turn when mail arrives.

## cwd vs worktree (critical)

| Intent | What to set |
|--------|-------------|
| Work **inside the current project**, isolated checkout | `cwd` = **project root** (or omit). Set `config.worktree.enabled = true`. |
| Work in a **different project/repo** | `cwd` = that project's root path (may register a new sidebar project). Optional `worktree` for isolation **inside that repo**. |
| Review another child's feature branch | Still: `cwd` = **project root**, `worktree.enabled = true`, `mode = "detach"`, `baseBranch` = that feature branch name. |

### Do **not**

- Put SuperOne worktree paths in `config.cwd` (paths under `~/.worktrees/…`, or names like `tjdllgg-735f677`).
- Copy `config.cwd` from a previous `session_collab_start` result into a later launch. After start, that field is the child's **runtime** worktree path for display — not a launch recipe.
- Expect two worktrees to check out the **same branch** (`mode: "branch"` / `"attach"`). Git allows a branch in only one worktree at a time.

### Do

- Prefer **host-managed** worktrees via `config.worktree` so the session stays under the **same sidebar project** as the main checkout.
- Use a **new unique `branchName`** per Implementer when `mode: "branch"`.
- For Reviewers of a branch already checked out by an Implementer, use `mode: "detach"` and `baseBranch` = that branch (detached HEAD at that ref).

## `config.worktree` fields

```json
{
  "cwd": "/path/to/project-root",
  "worktree": {
    "enabled": true,
    "baseBranch": "main",
    "mode": "branch",
    "branchName": "feat/my-isolated-work",
    "carryLocalChanges": false
  }
}
```

| Field | Meaning |
|-------|---------|
| `enabled` | Must be `true` to create a host-managed worktree. |
| `baseBranch` | Git ref in the **cwd** repo (branch, tag, or commit). |
| `mode` | `branch` — create `branchName` from `baseBranch`. `detach` — detached HEAD at `baseBranch` (safe when that branch is already checked out elsewhere). `attach` — check out existing `baseBranch` (fails if already checked out in another worktree). |
| `branchName` | Required for `mode: "branch"`. Unique across concurrent worktrees. |
| `carryLocalChanges` | Optional; copy uncommitted changes from the source into the new worktree. |

## Examples

### Parallel implementers on one repo

```json
{
  "launches": [
    {
      "agentId": "claude-base",
      "name": "Alice",
      "role": "Implementer",
      "task": "…",
      "config": {
        "worktree": {
          "enabled": true,
          "baseBranch": "main",
          "mode": "branch",
          "branchName": "feat/alice-piece"
        }
      }
    },
    {
      "agentId": "claude-base",
      "name": "Bob",
      "role": "Implementer",
      "task": "…",
      "config": {
        "worktree": {
          "enabled": true,
          "baseBranch": "main",
          "mode": "branch",
          "branchName": "feat/bob-piece"
        }
      }
    }
  ]
}
```

### Reviewer of an implementer's branch

```json
{
  "agentId": "codex-base",
  "name": "Review",
  "role": "Reviewer",
  "task": "Review feat/alice-piece …",
  "config": {
    "worktree": {
      "enabled": true,
      "baseBranch": "feat/alice-piece",
      "mode": "detach"
    }
  }
}
```

Omit `cwd` (or set it to the project root). Do **not** set `cwd` to `~/.worktrees/<repo>/…`.

### Child in a different project

```json
{
  "config": {
    "cwd": "/Users/you/Code/OtherApp",
    "worktree": {
      "enabled": true,
      "baseBranch": "main",
      "mode": "branch",
      "branchName": "feat/other-work"
    }
  }
}
```

That may add **OtherApp** as its own sidebar project. Same-repo worktrees never become separate projects when you use `worktree` correctly.

## Permission / sandbox

Nobody watches child sessions. Prefer `permissionMode: "bypassPermissions"` (or `"auto"` for ACP) so the child is not stuck on an unanswered approval prompt. The user can still downgrade modes in the approval dialog. Details live on the `permissionMode` field of `session_collab_request`.

## Mailbox

Write `session_collab_send` content as Markdown. After send, end the turn or do other work — do not poll. On wake, call `session_collab_retrieve`.

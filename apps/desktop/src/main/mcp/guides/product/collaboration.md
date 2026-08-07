# SuperOne agent collaboration (`session_collab_*`)

Read this before `session_collab_request`, especially when a child needs an isolated checkout or a different project.

## Launch flow

| Step | Action |
|------|--------|
| 1 | Call `session_collab_list_agents` and choose an `agentId`. A profile can launch more than one session. |
| 2 | Call `session_collab_request` with one or more launches. Give every launch an agent-chosen `name`, `role`, and focused `task`. |
| 3 | Wait for user approval. Each approved launch returns a private, one-shot credential. |
| 4 | Call `session_collab_start` for every credential back-to-back. Children run asynchronously, so do not wait for one before starting the next. |
| 5 | Exchange durable Markdown handoffs with `session_collab_send` and `session_collab_retrieve`. Delivery is push-based; never poll while waiting. |

## Choose `cwd` or `worktree`

Treat `cwd` as the child session's **project identity**, not as a checkout path.

| Intent | `config.cwd` | `config.worktree` | Result |
|--------|--------------|-------------------|--------|
| Work in the current project, shared checkout | Omit it, or use the current project root | Omit it | Child uses the current checkout and stays in the current sidebar project. |
| Work in the current project, isolated checkout | Omit it, or use the current project root | Set `enabled: true` | Host creates the checkout and keeps the child in the current sidebar project. |
| Review a branch already checked out elsewhere | Omit it, or use the current project root | Set `enabled: true`, `mode: "detach"`, and `baseBranch` to the feature branch | Reviewer gets an isolated detached checkout without competing for the branch. |
| Work in a genuinely different project/repo | Set it to that project's root | Optional; use it only to isolate work inside that repo | The other project may appear as its own sidebar project. |

### Anti-patterns

| Do not | Why it is wrong | Use instead |
|--------|-----------------|-------------|
| Set `cwd` to `~/.worktrees/<repo>/<leaf>` or another same-repo worktree leaf | It presents a checkout path as a new project and can create a fake sidebar project. | Keep `cwd` at the project root (or omit it) and enable `config.worktree`. |
| Copy the `cwd` returned by `session_collab_start` into a later launch | The returned value is the child's resolved runtime checkout path, not a launch recipe. | Reuse the project root plus a fresh `config.worktree` request. |
| Launch parallel `branch` or `attach` worktrees on the same branch | Git permits a branch to be checked out in only one worktree. | Give implementers unique `branchName` values; use `detach` for reviewers. |
| Set `cwd` merely because the child needs isolation | `cwd` changes project identity; it does not express same-repo isolation. | Express isolation with `config.worktree`. |

## `config.worktree` fields

| Field | Meaning |
|-------|---------|
| `enabled` | Set to `true` to request a host-managed worktree. |
| `baseBranch` | Branch, tag, or commit in the project-root repo to start from. |
| `mode` | `branch` creates `branchName`; `detach` checks out `baseBranch` at detached HEAD; `attach` checks out the existing `baseBranch`. |
| `branchName` | Required with `mode: "branch"`; it must be unique across concurrent worktrees. |
| `carryLocalChanges` | Optional. Copy uncommitted source-checkout changes into the new worktree. |

Use `attach` only when no other worktree has that branch checked out. Use `detach` for read-only review of a branch that an implementer already owns.

## Recipes

### Parallel implementers in the current project

Omit `cwd`. Give each implementer a unique branch.

```json
{
  "launches": [
    {
      "agentId": "claude-base",
      "name": "Alice",
      "role": "Implementer",
      "task": "Implement the API change and run focused tests.",
      "config": {
        "worktree": {
          "enabled": true,
          "baseBranch": "main",
          "mode": "branch",
          "branchName": "feat/api-change"
        }
      }
    },
    {
      "agentId": "codex-base",
      "name": "Blake",
      "role": "Implementer",
      "task": "Implement the UI change and run focused tests.",
      "config": {
        "worktree": {
          "enabled": true,
          "baseBranch": "main",
          "mode": "branch",
          "branchName": "feat/ui-change"
        }
      }
    }
  ]
}
```

### Reviewer for an implementer's branch

The implementer already owns `feat/api-change`, so the reviewer uses `mode: "detach"`.

```json
{
  "launches": [
    {
      "agentId": "codex-base",
      "name": "Casey",
      "role": "Reviewer",
      "task": "Review feat/api-change and report correctness risks with file references.",
      "config": {
        "worktree": {
          "enabled": true,
          "baseBranch": "feat/api-change",
          "mode": "detach"
        }
      }
    }
  ]
}
```

### Child in a different project

Set `cwd` only because this launch targets a genuinely different project root. The optional worktree is then created inside that repo.

```json
{
  "launches": [
    {
      "agentId": "claude-base",
      "name": "Dana",
      "role": "Implementer",
      "task": "Implement the matching client change in OtherApp.",
      "config": {
        "cwd": "/Users/you/Code/OtherApp",
        "worktree": {
          "enabled": true,
          "baseBranch": "main",
          "mode": "branch",
          "branchName": "feat/client-change"
        }
      }
    }
  ]
}
```

## Permission and sandbox

Nobody watches child sessions. Prefer the most autonomous mode that can finish the task: `permissionMode: "bypassPermissions"` for Claude-family and Codex harnesses, or `"auto"` for ACP. The user can downgrade permission and sandbox settings in the approval dialog. Use `"plan"` or `"default"` only when stopping for human review is the purpose of the launch.

## Mailbox

Write `session_collab_send` content as structured Markdown. Use `clientMessageId` when a send may be retried. After sending, continue other work or end the turn. When a collaboration wake arrives, call `session_collab_retrieve`; an `empty` result is not a reason to sleep or poll.

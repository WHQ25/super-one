# SuperOne agent collaboration (`session_collab_*`)

Read this before `session_collab_request`, especially when a child needs an isolated checkout or a different project.

## Two launch modes

| `mode` | Purpose | Required fields | Injection |
|--------|---------|-----------------|-----------|
| `spawn` (default) | Create a **new** child session | `agentId`, `name`, `role`, `summary`, `task` | Child gets collaboration **system prompt** with credential |
| `link` | Mailbox with an **existing** session | `sessionId`, `summary` (`task` = optional opening body; omit for wake-only) | Peer is woken via **turn injection** only — never system prompt. Link peers stay top-level in the sidebar (not nested under the initiator). |

`sessionId` for `link` must be a real SuperOne session id (from `@chat` mentions or `session_list` / `session_search`). Never invent ids. Do not use `spawn` when the target already exists.

## Launch flow

| Step | Action |
|------|--------|
| 1 | **Spawn:** call `session_collab_list_agents` and choose an `agentId`. **Link:** take `sessionId` from `@chat` / session tools. |
| 2 | Call `session_collab_request` with one or more launches (`mode` optional, defaults to `spawn`). Spawn: invent `name`/`role`, pass `summary` + full Markdown `task`. Link: pass `sessionId` + `summary` (+ optional `task` opening). |
| 3 | Wait for user approval. Each approved launch returns a private, one-shot credential. |
| 4 | Call `session_collab_start` for every credential back-to-back. Spawn: host creates the child and delivers `task`. Link: host binds the peer and wakes it (opening via mailbox + turn wake). |
| 5 | Exchange durable Markdown handoffs with `session_collab_send` and `session_collab_retrieve`. Delivery is push-based; never poll while waiting. |

### Link example

```json
{
  "launches": [
    {
      "mode": "link",
      "sessionId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
      "summary": "Align with the existing review session on API shape",
      "task": "Please confirm the request/response types for the new endpoint."
    }
  ]
}
```

A single request may mix spawn and link launches (one confirm card, multiple tabs).

## Choose `cwd` or `worktree`

Treat `cwd` as the child session's **project identity**, not as a checkout path.

**Default:** omit both when the child can share the current project checkout. That is the right default for **read-only review of the current WIP** (local dirty tree, same branch the parent is on). A worktree is not a free safety layer — it costs setup time, can desync uncommitted state, and is only required when isolation or a different checkout is actually needed.

| Intent | `config.cwd` | `config.worktree` | Result |
|--------|--------------|-------------------|--------|
| Shared checkout (review current WIP, read-only explore, same tree as parent) | Omit it, or use the current project root | **Omit it** | Child uses the current checkout. Prefer this for pure review. |
| Parallel implementers / write isolation in the current project | Omit it, or use the current project root | Set `enabled: true` (`mode: "branch"` + unique `branchName`) | Host creates an isolated checkout; child stays in the current sidebar project. |
| Review a feature branch another implementer already has checked out | Omit it, or use the current project root | Set `enabled: true`, `mode: "detach"`, `baseBranch` = that feature branch | Reviewer gets a detached checkout without competing for the branch. Only when the branch is already owned elsewhere. |
| Work in a genuinely different project/repo | Set it to that project's root | Optional; use it only to isolate work inside that repo | The other project may appear as its own sidebar project. |

### When worktree is **not** needed

| Situation | Why omit worktree |
|-----------|-------------------|
| Code review / design review of the **current** uncommitted or on-branch changes | Shared checkout already has the files; `git status` / `git diff` match the parent. |
| Child task is read-only (report findings, no expected file edits) | Sandbox + permission mode already constrain writes; a second checkout adds cost without isolation benefit. |
| Single implementer already working in the parent session's tree | No branch-ownership conflict to solve. |

Use `sandboxMode` and a clear “review only — do not implement” task when you need guardrails for a shared checkout. Do **not** open a worktree solely because the role is “Reviewer”.

### Anti-patterns

| Do not | Why it is wrong | Use instead |
|--------|-----------------|-------------|
| Open a worktree for every reviewer by default | Unnecessary cost; `carryLocalChanges` can drift from the parent dirty tree; local WIP review becomes harder to verify. | Omit `config.worktree` for review of the current shared checkout. |
| Set `cwd` to `~/.worktrees/<repo>/<leaf>` or another same-repo worktree leaf | It presents a checkout path as a new project and can create a fake sidebar project. | Keep `cwd` at the project root (or omit it). Use `config.worktree` only when isolation is required. |
| Copy the `cwd` returned by `session_collab_start` into a later launch | The returned value is the child's resolved runtime checkout path, not a launch recipe. | Reuse the project root; add a fresh `config.worktree` only if isolation is still required. |
| Launch parallel `branch` or `attach` worktrees on the same branch | Git permits a branch to be checked out in only one worktree. | Give implementers unique `branchName` values; reviewers use shared checkout or `detach` only when reviewing an implementer-owned branch. |
| Set `cwd` merely because the child needs isolation | `cwd` changes project identity; it does not express same-repo isolation. | Express isolation with `config.worktree` when implementers need separate checkouts. |

## `config.worktree` fields

| Field | Meaning |
|-------|---------|
| `enabled` | Set to `true` to request a host-managed worktree. |
| `baseBranch` | Branch, tag, or commit in the project-root repo to start from. |
| `mode` | `branch` creates `branchName`; `detach` checks out `baseBranch` at detached HEAD; `attach` checks out the existing `baseBranch`. |
| `branchName` | Required with `mode: "branch"`; it must be unique across concurrent worktrees. |
| `carryLocalChanges` | Optional. Copy uncommitted source-checkout changes into the new worktree. Prefer sharing the parent checkout for reviewing local WIP instead of relying on this copy. |

Use `attach` only when no other worktree has that branch checked out. Use `detach` only when reviewing a branch that an implementer **already owns** in another worktree (branch-checkout conflict). Pure review of the parent’s current tree does not need `detach`.

## Recipes

### Review current WIP (no worktree)

Default for “review my local changes” / “code review this session’s diff”. Omit `cwd` and `worktree` so the child sees the same checkout as the parent.

```json
{
  "launches": [
    {
      "agentId": "codex-base",
      "name": "Casey",
      "role": "Reviewer",
      "summary": "Review uncommitted WIP (read-only)",
      "task": "Review the uncommitted work with git status/diff. Report bugs and risks with file:line. Do not implement fixes.",
      "config": {
        "permissionMode": "bypassPermissions",
        "sandboxMode": "on"
      }
    }
  ]
}
```

### Parallel implementers in the current project

Omit `cwd`. Give each implementer a unique branch.

```json
{
  "launches": [
    {
      "agentId": "claude-base",
      "name": "Alice",
      "role": "Implementer",
      "summary": "Implement API change + tests",
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
      "summary": "Implement UI change + tests",
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

### Reviewer for an implementer's already-owned branch

Only when an implementer already has `feat/api-change` checked out in another worktree. Shared checkout cannot hold that branch twice, so the reviewer uses `mode: "detach"`. If you are reviewing the parent’s current dirty tree instead, use **Review current WIP** above — no worktree.

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

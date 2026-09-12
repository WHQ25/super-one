# 07. Worktree

状态：Codex 原生 [DEFERRED]；SuperOne 自有 fork [VERIFY]

## 原生 `--worktree` / `/worktree` — [DEFERRED]

0.154 的 experimental worktree（feature `Worktrees`，默认 false）与 SuperOne 已有隔离重叠：

- Session fork 可 `activateWorktree`，detached checkout，失败回滚（[`session-fork.ts`](../../../../apps/desktop/src/main/session/session-fork.ts)）。
- `session_collab_*` 的 spawn/handoff 可选 worktree isolation。
- cwd 通过 `thread/start` / `thread/resume` 的 `cwd` 传给 Codex。

再接 Codex 原生 worktree 会出现两套目录、两套生命周期。等官方去掉 experimental、app-server 有稳定 create/list/resume RPC，并且与 SuperOne `worktreePath` 单一来源，再评估。

## SuperOne 自有 worktree — [VERIFY]

升级后跑一次：Codex 会话 fork 到新 git worktree，`thread/fork` + 新 `cwd` 仍能 resume。若 0.154 把某种 worktree 配置写进 thread metadata，确认它不会覆盖 SuperOne 的 `cwd`。

这是本轮唯一与 worktree 相关的必做回归。

# 05. Thread History 生命周期

状态：[PARTIAL]

## 目标

利用 `thread/list`、`thread/read`、`thread/loaded/list`、`thread/turns/list`、`thread/items/list`、`thread/archive`、`thread/delete`、`thread/unarchive`，让 Codex 原生历史可分页读取、归档和删除，并与 SuperOne session UI 保持一致。

## 当前差距

仓库已有 resume/read/fork 和自己的 SQLite session 表，但没有完整使用 Codex 原生分页与归档生命周期。两套存储不能互相假设完全一致。

## 实现设计

- Main 以 `threadId` 为 Codex 权威 id，以 SuperOne `sessionId` 为产品实体 id，保留双向映射。
- Sidebar 首屏只请求一页；滚动到底部再请求 cursor，不做全量 rollout 扫描。
- `thread/read` 用于详情预览，不为了显示列表而 resume thread。
- 归档/删除先更新 UI 的 pending 状态，成功后处理通知；失败则回滚。
- Codex 原生删除不得无条件删除 SuperOne SQLite 记录，必须由产品删除策略显式决定。

## UI/UX

- Sidebar 支持分页加载、搜索、Archived 过滤和 pinned 状态。
- Session context menu：Archive、Unarchive、Delete；Delete 显示影响的 descendant 数量。
- 打开历史会话时显示“正在恢复 Codex thread”，失败提供 Retry 和“新建会话”。
- 状态徽标区分 loaded、active、notLoaded、archived、error，不把 notLoaded 当作断线。

## 验收

- 大量历史分页不阻塞 renderer。
- archive/delete/unarchive 通知与 UI 状态幂等。
- Codex rollout 缺失时不会删除本地可恢复记录；能给出修复入口。

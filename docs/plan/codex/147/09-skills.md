# 09. Skills 动态发现

状态：[PARTIAL]

已实现：Main 通过 `skills/list` 返回 `enabled`，支持显式 `forceReload`，并通过 `skills/config/write` 提供 Codex skill 启停 IPC；renderer 的 Codex Skills 页面可读取和切换状态。

## 目标

利用 `skills/list`、`skills/changed`、`skills/extraRoots/set` 和 `skills/config/write`，让项目级 Skills 的发现、额外根目录和启停状态与 Codex runtime 保持同步。

## 实现设计

- projectPath、user home、extra roots 分开建模，禁止把 home skill 混进项目可移植配置。
- 首次打开 Skills 页面读缓存；用户显式刷新才 `forceReload`。
- 收到 `skills/changed` 后增量失效缓存并推送 renderer；页面不自动打断正在运行的 turn。
- `skills/config/write` 作为唯一启停写入口，响应成功后再更新 UI。
- 旧 runtime 不支持动态通知时，手动刷新仍可用。

当前限制：尚未订阅 `skills/changed` 做自动失效；远程项目的 Codex skill toggle 需要 Environment Gateway 路由，目前明确 fail closed。

## UI/UX

- Skills 页面按 Project、User、Extra roots 分组，显示 enabled/disabled、来源路径和更新时间。
- 监听到变更时顶部显示非阻塞 toast：“Skills changed · Refresh”。
- 禁用 skill 使用 switch，保存中显示 spinner，失败恢复原值。
- 点击 skill 打开右侧详情面板，显示 description、路径、最近发现时间和依赖状态。

## 代码边界与安全

- 复用 `apps/desktop/src/main/codex/codex-skills-rpc-service.ts`，由 Main 负责 cwd 和路径校验。
- Renderer 只能传 project path 和 skill path，不得传任意 home path 覆盖 extra roots。
- 列表响应不回传 skill 文件全文；内容读取走明确的详情权限。

## 测试/验收

- 多项目切换不串 cwd 的 skill。
- 文件变化不会造成重复请求或闪烁。
- enable/disable 成功、失败、runtime 不支持三种状态均可恢复。

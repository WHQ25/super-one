# 10. Hooks 发现与诊断

状态：[VALIDATED LOCALLY]

已实现：`hooks/list` 的 cwd 分组、hook 字段归一化、warnings/errors 展示和刷新 IPC；renderer 刷新时请求当前 cwd。

## 目标

使用 `hooks/list` 展示项目/用户范围内发现的 lifecycle hooks、warnings 和 errors；Hook 执行仍由 Codex runtime 负责，SuperOne 不复制执行器。

## 实现设计

- 以 `cwds` 明确请求范围，结果按 cwd 分组缓存。
- hook discovery 与 execution 分离：列表页只读，不因为打开页面而运行 hook。
- warnings/errors 作为结构化字段保存，禁止从 stderr 文本猜状态。
- runtime 更新或 cwd 切换时失效缓存；旧版本无 hooks/list 时显示不可用而非空列表。

## UI/UX

- Settings → Hooks 使用表格：Hook name、event、scope、status、source。
- warnings 使用黄色状态行，errors 使用红色状态行；点击后在侧面板展开诊断。
- 诊断面板提供复制摘要和“重新扫描”，不把原始 stderr 填满主页面。
- Hook 不可执行时显示原因和修复建议，不提供无效的 Enable 按钮。

## 代码边界与安全

- `apps/desktop/src/main/codex/codex-hooks-service.ts` 做响应归一化和路径脱敏。
- Hooks 的命令、环境变量和 secret 默认只显示摘要。
- 任何“允许 hook”操作必须经过现有权限策略，不由 hooks/list 结果直接授权。

## 测试/验收

- populated、empty、warnings、errors 响应映射正确。
- 多 cwd、刷新、连接断开和旧 runtime 降级行为有测试。
- UI 不会把 hook discovery error 误报成 Codex turn error。

当前限制：0.147 schema 没有 `forceReload` 参数，因此刷新保留为重新请求，不向 runtime 发送未支持字段；尚未实现 hooks 变更通知订阅。

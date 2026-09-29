# 04. Dynamic Tools 与工具事件

状态：[PLANNED]

## 目标

将 SuperOne 在运行时才知道的工具以 App Server `dynamicTools` 注册到线程，让 Codex 调用后通过 `dynamicToolCall` 事件进入统一的工具执行管线。

## 适用场景

- Mini-app/Widget 根据当前 app 动态暴露的动作。
- 远程环境按节点能力暴露的工具。
- 需要由 SuperOne 主进程执行、而不是由 Codex MCP 子进程执行的轻量动作。

## 实现设计

- `packages/shared` 定义 `DynamicToolDescriptor`：稳定 name、description、JSON Schema、scope、risk。
- `thread/start`/`thread/resume` 注入动态工具；未显式提供时按线程持久化配置恢复。
- Main 的 dispatcher 收到 `dynamicToolCall` 后，按 `tool + environment + session` 路由到注册表。
- 工具执行结果转为成功/失败 content items；超时和取消必须可区分。
- 动态工具注册表不允许 renderer 任意写入，必须经过 Main 的白名单和 schema 校验。

## UI/UX

- 工具来源在 ToolBlock 中显示为 `SuperOne · Mini App`、`SuperOne · Remote` 等稳定标签。
- 高风险工具沿用 PermissionPrompt，显示参数摘要和作用范围；低风险只在首次使用时提示。
- 工具注册变化用 session footer 的“工具已更新”提示，不打断当前 turn。
- 调试面板可查看 descriptor、输入校验错误、耗时和结果摘要，但默认隐藏敏感参数。

## 安全与兼容

- tool name 必须命名空间化，禁止覆盖 `mcp__*` 或 Codex 内置工具。
- JSON Schema 只允许受支持的类型和大小；限制 descriptor 与参数总长度。
- 0.146.1 不支持 dynamicTools 时按 MCP 或静态工具路径降级。

## 验收

- Codex 能发现工具并成功调用；并行调用不串路由。
- 参数 schema 错误在调用前返回；执行失败在 UI 显示可读原因。
- session fork/resume 后工具集合符合预期，不残留已卸载 Mini-app 的工具。

# Codex App Server 0.147 集成计划

状态：1、9、10、11 已实现基础链路，真实远程节点验证待补

日期：2026-08-13

目标版本：`@openai/codex` `0.147.0`

本目录描述 Codex App Server 0.147 值得接入 SuperOne 的功能。每个功能单独成文，文档同时覆盖协议、代码归属、状态流、UI/UX、安全边界、兼容策略和验收标准。这里的“计划”不代表功能已经实现。

## 文档状态

- **[PLANNED]**：尚未实现。
- **[PARTIAL]**：仓库已有相关能力，但仍缺少完整产品化接入或远程节点闭环。
- **[VALIDATED LOCALLY]**：本地协议映射和聚焦单测已通过；不代表三平台打包或远程节点已验证。
- **[VALIDATION PENDING]**：实现存在，但尚未完成真实 runtime 或多平台验证。
- **[DEFERRED]**：当前不建议进入实现周期。

## 当前基线

- 桌面和 managed runtime 已锁定 `@openai/codex` `0.147.0`；安装后的 CLI 已验证为 `codex-cli 0.147.0`。
- npm `latest` 是 `0.147.0`；`0.148.0` 当前仍为 alpha，暂不跟进。
- Electron Main 已通过 App Server JSON-RPC 连接，并在 `initialize` 中启用 `experimentalApi`。
- 已有 `thread/start`、`thread/resume`、`thread/fork`、`turn/start`、`turn/steer`、`turn/interrupt`、`review/start`、`thread/compact/start`、Goals、模型列表、Skills、Hooks、MCP 状态和账户用量等能力。
- renderer 不应直接持有 Codex 连接或凭据；连接、权限、重试、协议解析归 Electron Main，UI 通过 preload IPC 和环境网关访问。
- 新会话能力优先接入 `EnvironmentGateway`，只在兼容旧本地路径时保留 `window.app`/`window.agent` 薄封装。

## 推荐顺序

1. 升级 `0.146.1 -> 0.147.0`，生成并审查版本锁定的协议 schema。
2. `command/exec`：独立命令/PTY 执行，直接改善终端和测试工作流。
3. `modelProvider/capabilities/read`：动态模型能力，修正模型选择器与输入能力显示。
4. `dynamicTools`：把 SuperOne 动态工具接入 Codex 线程，统一结构化调用和事件。
5. Thread History APIs：分页、归档、删除、恢复和读取，减少本地状态与 Codex rollout 的漂移。
6. `thread/inject_items`：上下文注入，先限定为受控的系统桥接场景。
7. Thread Sections：只有侧边栏要支持分组/文件夹时才实施。

## 暂缓项

- `process/*`：绕过 Codex sandbox，安全边界扩大，不作为普通终端的实现方式。
- WebSocket App Server：官方仍标记为 experimental/unsupported for production，不替代 SuperOne Remote Node 协议。
- App Server v2 filesystem API：SuperOne 已有 Environment FS API，重复建设会产生权限与事件一致性问题。

## 横向验收要求

- 协议请求必须经过单连接 dispatcher；响应、通知和 server request 不能互相吞掉。
- 新方法必须对 0.146.1 做能力探测或可控降级，不能因单个新方法不可用导致 Codex 会话不可用。
- UI 必须覆盖 loading、空状态、错误、超时、断线重连、权限拒绝和旧 runtime 降级。
- 不在 renderer 暴露 API key、ChatGPT token、MCP OAuth refresh token 或远程节点凭据。
- 每项功能至少有协议单测；涉及 UI 的功能补 renderer 测试；涉及真实二进制的功能补 runtime smoke test。

## 功能文档

| 文件 | 功能 | 状态 |
|---|---|---|
| [01-runtime-upgrade.md](./01-runtime-upgrade.md) | 0.147.0 runtime 升级与 schema 管理 | [VALIDATED LOCALLY] |
| [02-command-exec.md](./02-command-exec.md) | 独立命令与 PTY 执行 | [PLANNED] |
| [03-model-capabilities.md](./03-model-capabilities.md) | provider/model 动态能力 | [PLANNED] |
| [04-dynamic-tools.md](./04-dynamic-tools.md) | dynamicTools 与动态工具事件 | [PLANNED] |
| [05-thread-history.md](./05-thread-history.md) | 历史分页、归档、删除、恢复 | [PARTIAL] |
| [06-thread-sections.md](./06-thread-sections.md) | Thread Sections 分组 | [PLANNED] |
| [07-context-injection.md](./07-context-injection.md) | `thread/inject_items` 上下文注入 | [PLANNED] |
| [08-permission-profiles.md](./08-permission-profiles.md) | permission profiles 与能力约束 | [PARTIAL] |
| [09-skills.md](./09-skills.md) | Skills 动态发现与刷新 | [PARTIAL] |
| [10-hooks.md](./10-hooks.md) | Hooks 发现与诊断 | [VALIDATED LOCALLY] |
| [11-mcp.md](./11-mcp.md) | MCP 状态、资源、工具和 OAuth | [PARTIAL] |
| [12-apps.md](./12-apps.md) | Apps/Connectors 产品化 | [PLANNED] |
| [13-process.md](./13-process.md) | process API 评估 | [DEFERRED] |
| [14-websocket.md](./14-websocket.md) | WebSocket App Server 评估 | [DEFERRED] |

## 统一 UI/UX 原则

1. 使用工作台式、密度适中的布局，不为协议概念增加营销式页面。
2. 运行状态以状态栏、行内状态和可展开详情表达；避免把日志堆成全屏弹窗。
3. 危险操作（删除、绕过 sandbox、OAuth、终止进程）使用明确的二次确认和风险文案。
4. 所有异步操作都要有可取消、可重试或可查看原因的出口。
5. UI 显示“当前环境”和“当前 Codex runtime 版本”，避免用户误以为本地和远程版本自动一致。

## 官方依据

- [Codex App Server 文档](https://learn.chatgpt.com/docs/app-server.md)
- [Codex App Server 源码](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- 0.147.0 schema：由对应 runtime 的 `codex app-server generate-ts` 生成，不直接把全量生成物当作业务类型维护。

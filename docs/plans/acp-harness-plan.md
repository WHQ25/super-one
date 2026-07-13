# ACP Harness（Chat Suggestions: Others）调研与实现计划

## Context

SuperOne 目前只有两条深度 harness：

| Harness | 接入方式 | UI |
|---|---|---|
| `claude` | Claude Agent SDK（原生） | ChatSuggestions「Claude Code」 |
| `codex` | Codex app-server 私有协议（原生） | ChatSuggestions「Codex」 |

Grok Build、Gemini CLI、OpenCode、Cursor CLI、Hermes ACP 等工具已经通过 **Agent Client Protocol (ACP)** 对外暴露 agent。T3 Code 接 Grok 就是这条路径：spawn agent stdio + ACP JSON-RPC。

**目标**：新增统一 **ACP harness**，在空会话的 Chat Suggestions 里显示为 **Others**；除 Claude Code / Codex 以外的 coding agent 都走 ACP，不再为每个 agent 单独做深度协议适配。

**与既有方案关系**：

- `docs/plans/hermes-agent-integration-plan.md` 曾否决 ACP（富特性丢失）。本方案**有意选择广度优先**：用 ACP 最小公分母快速覆盖多 agent；Hermes 若要 cron/kanban 等富 UI，仍可后续单独做「控制台」形态，聊天主链路统一走 ACP。
- Claude / Codex **保持现状**，不走 ACP（避免降级已有体验）。

---

## Recommended approach

### 产品形态

```
ChatSuggestions Tabs:
  [ Claude Code ]  [ Codex ]  [ Others ]
                              └── 选具体 ACP Agent（Grok Build / Gemini / OpenCode / … / Custom）
```

- **HarnessId**：`acp`（技术 id，稳定）
- **展示名**：`Others`（ChatSuggestions / 侧栏等用户可见文案）
- **一个 harness，多个 agent**：session 配置里带 `agentId`（及可选 custom command），而不是 `HarnessId = grok | gemini | …`

### 架构

```
Renderer (Chat UI)
    │  preferredProvider = 'acp', agentId = 'grok-build'
    ▼
SessionManager → harnessRegistry.get('acp').createBackend()
    ▼
AcpBackend (SessionBackend)
    │  spawn(command, args) stdio
    ▼
@agentclientprotocol/sdk  ClientSideConnection
    │  initialize / session/new / session/prompt / session/cancel
    │  ← session/update, session/request_permission
    ▼
外部 ACP Agent 进程（grok / gemini / opencode / …）
```

依赖官方 SDK：[`@agentclientprotocol/sdk`](https://www.npmjs.com/package/@agentclientprotocol/sdk)（`ClientSideConnection`）。

### 内置 Agent 目录（MVP + 可扩展）

| agentId | 显示名 | 默认启动命令 | 鉴权 | 优先级 |
|---|---|---|---|---|
| `grok-build` | Grok Build | `npx -y @xai-official/grok agent stdio`（或本机 `grok agent stdio`） | SuperGrok / X Premium+ / `XAI_API_KEY` | P0 |
| `gemini-cli` | Gemini CLI | `gemini --experimental-acp`（以官方文档为准） | Google 登录 / API key | P1 |
| `opencode` | OpenCode | 官方 ACP 入口 | 自有配置 | P1 |
| `cursor` | Cursor CLI | Cursor ACP 命令 | Cursor 登录 | P2 |
| `custom` | Custom… | 用户配置 command + args + env | 用户自理 | P0 |

Agent 探测：启动前 `which` / `spawn --version`；未安装时 UI 显示安装引导，不阻塞其他 agent。

---

## ACP ↔ SuperOne 映射（核心）

### SessionBackend 方法

| SessionBackend | ACP | MVP 行为 |
|---|---|---|
| `start` | spawn → `initialize` → `authenticate?` → `session/new` | 必做 |
| `send` | `session/prompt` | 必做 |
| `interrupt` | `session/cancel` | 必做 |
| `close` | 杀子进程 + 断连 | 必做 |
| `respondToPermission` | `session/request_permission` 的 response | 必做 |
| `setPermissionMode` / `setModel` / `setSandbox` | `session/set_mode` 等（若 agent 声明 capability） | 有则接，无则 no-op |
| `rebuild` / `prewarm` | 重建子进程；prewarm 可预 spawn | 简化 |
| `getContextUsage` / MCP / rewind / plugins | 通常无 ACP 等价 | 返回空 / false |
| `forkTranscript` | 一般无 | 返回新 id 或不支持 |
| `respondToQuestion` / plan approval | 映射到 permission options / mode | 尽力 |

### `session/update` → `AgentEvent`

| ACP update | AgentEvent / ContentBlock |
|---|---|
| agent_message_chunk | `content_delta` text |
| agent_thought_chunk | `content_delta` thinking |
| tool_call / tool_call_update | `tool_use` + 后续 `tool_result` |
| plan | 文本/plan 块（generic） |
| available_commands_update | 可选 slash 列表 |
| mode 变更 | `permission_mode_change`（若可映射） |
| stop_reason（prompt 结束） | `message_complete` + `status_change: idle` |

权限：`session/request_permission` → 现有 `permission_request` + `PermissionPrompt` UI。

Client 侧可选实现：`fs/read_text_file` / `fs/write_text_file` / `terminal/*`——**MVP 先不实现**，让 agent 自管工具；若某 agent 强制要求 client fs，再补。

### 能力表

```ts
// packages/shared/src/harness/harness-capabilities.ts
acp: {
  supportsMcp: false,
  supportsPlanMode: false,       // 除非 agent 暴露 mode
  supportsTodos: false,
  supportsSubagents: false,
  supportsCompact: false,
  supportsStreamingToolInput: false,
  displayName: 'Others',
}
```

UI 通过 `HARNESS_CAPABILITIES['acp']` 隐藏 Claude/Codex 专属控件（TODO、MCP 面板、Codex collab 等）。

---

## 关键改动面（按层）

### 1. 类型与能力（shared）

| 文件 | 改动 |
|---|---|
| `packages/shared/src/agent-types.ts` | `HarnessResourcesMap` 加 `acp: AcpResources`；放宽若干 `'claude' \| 'codex'` 为 `HarnessId`（Remote/mobile 协议、history 等） |
| `packages/shared/src/harness/harness-capabilities.ts` | 注册 `acp` 能力 |
| `packages/shared/src/harness/harness-brand.ts` | 默认 brand hue（建议中性灰/紫，如 `280`） |
| `packages/shared/src/platform-registry/*` | **MVP 不把 acp 绑进 chat:claude/codex 的 provider 协议**；ACP agent 自带鉴权。后续若要 API key 透传再扩展 `ConsumerId` |

`AcpResources`（最小）：

```ts
interface AcpAgentDescriptor {
  id: string
  name: string
  installed: boolean
  commandPreview: string
}
interface AcpResources {
  agents: AcpAgentDescriptor[]
  selectedAgentId: string | null
}
```

### 2. Main：ACP 运行时 + Backend

新建 `apps/desktop/src/main/acp/`：

| 模块 | 职责 |
|---|---|
| `agent-catalog.ts` | 内置 agent 定义 + custom 合并 |
| `acp-process.ts` | spawn/kill、stdio 管道、崩溃重启策略 |
| `acp-client.ts` | 封装 `@agentclientprotocol/sdk` ClientSideConnection |
| `acp-event-map.ts` | ACP updates → `AgentEvent`（**纯函数，单测重点**） |
| `acp-permission-map.ts` | permission request/response 映射 |
| `acp-detect.ts` | 探测本机是否安装各 agent |

新建 backend：

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/main/session/backends/acp-backend.ts` | 实现 `SessionBackend` |
| `apps/desktop/src/main/session/backends/acp-fork.ts` | MVP：不支持真实 fork / 浅复制 |

注册：

- `apps/desktop/src/main/session/harness-registry.ts` → `acpHarness`
- DB：`session_providers` 种子 `acp-base`（与 `claude-base` / `codex-base` 同模式）
- config schema：

```ts
z.object({
  agentId: z.string(),                    // 'grok-build' | 'gemini-cli' | …
  command: z.string().optional(),         // custom 覆盖
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  cwd: z.string().optional(),
}).passthrough()
```

### 3. Renderer：Chat Suggestions + 选择体验

| 文件 | 改动 |
|---|---|
| `ChatSuggestions.tsx` | Tabs 增加 `Others`；`preferredProvider === 'acp'` 时图标用通用/others icon；下方 **Agent 下拉** 选择具体 ACP agent |
| chat store `ChatProvider` | 已是 `HarnessId`，随类型扩展自动支持 |
| `setPreferredProviderImpl` | 处理 `acp` session id 规则（可与 claude 同用 UUID，无需 codex 特殊 id） |
| Model/Permission selectors | acp 会话隐藏或降级为 capability 驱动 |
| `HarnessSessionIcons` | 增加 Others 图标（简单几何 / 插件状） |
| i18n | `chat.suggestions.others`、agent 安装引导文案 |

交互细节：

1. 用户点 **Others** → `preferredProvider = 'acp'`
2. 若未选 agent，展示 agent 列表（已安装优先）
3. 选中 agent 写入 session/provider config（`agentId`）
4. 首条消息发送时 `SessionManager` 用 `acp-base` + config 创建 backend

### 4. 不在 MVP 范围

- 不为每个 ACP agent 做 plugins/skills/MCP 专属页
- 不把 Grok/Gemini 塞进现有 Providers（API key）平台（agent 自登录）
- Remote mobile 全量支持（类型放宽即可，深测可 P2）
- ACP client 侧 terminal/fs 代理
- 与 Hermes 深度面板并存（聊天走 ACP；富控制台另案）

---

## 复用点

| 已有能力 | 路径 |
|---|---|
| `SessionBackend` 接口 | `apps/desktop/src/main/session/types.ts` |
| Registry 模式 | `harness-registry.ts`（照抄 claude/codex 条目） |
| Codex spawn stdio 经验 | `apps/desktop/src/main/codex/app-server-connection.ts` |
| 事件进 store | Session → AgentEvent 广播链路 |
| Permission UI | `PermissionPrompt.tsx`（generic 即可） |
| Tool 渲染 | `ToolBlock` generic 路径 |
| Capability 门控模式 | `HARNESS_CAPABILITIES` |
| Chat provider 切换 | `setPreferredProviderImpl` / `ChatSuggestions` |

---

## 分 PR 实施顺序

### PR1 — 类型 + 空 harness 骨架（不连真 agent）

- `HarnessId` 扩 `acp`
- capabilities / brand / registry / `acp-base` seed
- `AcpBackend` stub：`send` 返回明确错误「agent not configured」
- ChatSuggestions 第三 tab「Others」（无 agent 列表也可）
- 测试：registry list 含 acp；切换 preferredProvider 不炸

### PR2 — ACP client 核心 + 事件映射

- 引入 `@agentclientprotocol/sdk`
- `acp-process` + `acp-client` + `acp-event-map`（单测 fixture）
- 用官方 example agent 或 mock stdio 做 integration test
- 打通：prompt → streaming text → message_complete

### PR3 — 权限 + 工具块

- `request_permission` ↔ PermissionPrompt
- tool_call → tool_use / tool_result
- interrupt / cancel / 进程崩溃错误展示

### PR4 — Agent catalog + Grok Build P0

- 内置 catalog + 探测
- UI agent 选择器 + 未安装引导
- 验证 Grok Build 端到端（需本机订阅/API key）
- Custom agent 配置（command/args/env）

### PR5 — 第二批 agent + 打磨

- Gemini CLI / OpenCode
- mode 映射（若 capability 允许）
- session resume（`session/load` 若 agent 支持）
- 文档：`docs/plans/acp-harness-plan.md` 定稿进仓

---

## 风险与决策

| 风险 | 缓解 |
|---|---|
| ACP 是最小公分母，体验不如 Claude/Codex | 文案明确 Others；能力表关高级 UI |
| 各 agent CLI 参数不稳定 | catalog 版本化 + custom 逃生口 |
| `HarnessId` 全库硬编码 `'claude'\|'codex'` | PR1 系统性放宽；用 `grep` 清单回归 |
| Electron 下 spawn PATH | 与 Codex 相同：login shell PATH / 绝对路径探测 |
| 鉴权在子进程浏览器弹窗 | 文档说明首次需在 CLI 登录；可选 env key |
| 与 Hermes 深度方案冲突 | 产品裁定：聊天统一 ACP；富特性另轨 |
| 安全：任意 custom command | custom agent 需用户确认；默认不跟进远程 session 权限 |

**已拍板（按你的描述）**：

1. 第三 harness 展示为 **Others**
2. Claude / Codex 继续原生；其余走 ACP
3. 技术 id 用 **`acp`**，一个 harness 多 agent

**实现前可再确认（非阻塞 MVP）**：

- Others 默认 agent 是否优先 Grok Build
- Custom agent 是否第一期就开放
- brand hue / 图标风格

---

## Verification

### 自动化

```bash
bunx vitest run apps/desktop/src/main/session/harness-registry.test.ts
bunx vitest run apps/desktop/src/main/acp/          # 新增
bunx vitest run apps/desktop/src/main/session/backends/acp-backend.test.ts
bun run typecheck
```

重点单测：

1. `acp-event-map`：message/tool/permission fixture → AgentEvent 快照
2. `AcpBackend`：mock transport 下 start/send/interrupt/close
3. `ChatSuggestions`：三 tab 渲染；选 Others 后 agent 列表

### 手工 E2E

1. 空会话 → 见 Claude Code / Codex / **Others**
2. 选 Others → 选 Grok Build（已安装）→ 发「列出当前目录文件」→ 流式回复 + 工具块
3. 触发权限 → Allow/Deny 生效
4. Stop → 子进程取消
5. 未安装 agent → 引导文案，不崩溃
6. 切回 Claude/Codex → 行为与现网一致（回归）

---

## Critical files (summary)

**新建**

- `apps/desktop/src/main/acp/*`
- `apps/desktop/src/main/session/backends/acp-backend.ts`
- `docs/plans/acp-harness-plan.md`（本计划落地副本）

**修改**

- `packages/shared/src/agent-types.ts`（HarnessResourcesMap / 放宽 union）
- `packages/shared/src/harness/harness-capabilities.ts`
- `packages/shared/src/harness/harness-brand.ts`
- `apps/desktop/src/main/session/harness-registry.ts`
- `apps/desktop/src/renderer/src/components/chat/ChatSuggestions.tsx`
- chat store session lifecycle / provider 切换相关
- i18n `zh.ts` / `en.ts`

**复用参考**

- `apps/desktop/src/main/session/backends/codex-backend.ts`（SessionBackend 形状）
- `apps/desktop/src/main/codex/app-server-connection.ts`（stdio spawn）
- `apps/desktop/src/renderer/src/components/chat/PermissionPrompt.tsx`

---

## Success criteria

1. ChatSuggestions 有 **Others**，且 `preferredProvider === 'acp'` 可创建会话
2. 至少一个真实 ACP agent（Grok Build）能完成一轮 prompt + tool + permission
3. Claude / Codex 无行为回归
4. 新增 agent 只需改 catalog 配置，无需新 harness id

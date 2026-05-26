# Desktop Chat / Harness 重构计划

> 目标：把 `apps/desktop/src/renderer/src/stores/chat.ts` (5119 行) 和 `components/chat/` 下的"假通用"组件按 harness (Claude / Codex) 边界拆开，建立清晰的 *通用层 ↔ harness 专属层* 分层。
>
> **修订记录**：本计划经过一次审核迭代，已修正以下点：(1) `HarnessId` 实际有三份来源（agent-types/session-types/chat.ts），统一方案需 re-export 而非新建第四份；(2) 新目录用 `chat-store/` 而非 `chat/`，避免与 `chat.ts` 同名解析冲突；(3) 阶段 0 不预建 capability 表，按消费点延后；(4) `HarnessHandler` 不接管 event pipeline 主导权（只暴露 helpers），保持事件顺序由中心化 `event-slice` 控制；(5) `applyDelta` / `mergeMessagesByMaxSeq` 已有测试，迁移时改 import 路径即可，不重写；(6) `harness-brand.ts` 移动需保留兼容 re-export。

## 落地进展记录（截至 2026-05-26）

| 阶段 | 状态 | 落地结果 |
|---|---|---|
| 0 基础设施 | ✅ 完成 | `HarnessId` 统一到 `agent-types.ts:1229`；`session-types.ts` 改 re-export；`ChatProvider` 改 type alias = `HarnessId`。 |
| 1 纯函数外提 | ✅ 完成 | 新建 `chat-store/helpers/codex-helpers.ts`（185 行）+ `event-helpers.ts`（70 行），搬 14 个纯函数 + `CodexCommand` type。 |
| 2 收敛 provider switch | ✅ 完成 | 新建 `chat-store/helpers/provider-routing.ts`：`resolveProvider(session)` + `inferProviderFromHarnessId(...)`，收敛 6 处散落 switch。 |
| 3 slice 拆分 | ⏸ 跳过 / 后续 PR | 评估：单独做 slice 拆分价值 vs 成本不划算（slice 间 cross-reference 多）。**真正切片化推迟到与业务重写共做**。chat-store/index.ts 仍是单文件 store body，但目录骨架已就位等待后续 slice 化。 |
| 4d ModelSelector | ✅ 完成 | 拆成 `model-selector/ClaudeModelSelector.tsx` + `CodexModelSelector.tsx`，主组件薄到 14 行。 |
| 4a/4b/4c | ⏸ 跳过 | **ModelSelector 是阶段 4 唯一"两套完整 UI 并列"的组件**，其余三个分支属于穿插式 / 散点式，拆完 95% 代码重复。 |
| 4e ChatInput | ⏸ 未做 / 后续 PR | 单独 PR 评估抽 hook 而非拆组件。 |
| 5 收尾 | ⏸ 部分完成 | `ChatProvider` 已 alias 为 `HarnessId`，自然衰退。`harness-capabilities.ts` 按消费点延后。 |
| **A** `packages/shared/harness/` 子包 | ✅ 完成 | 移 `harness-brand.ts` 进 `harness/`，新建 `harness/harness-id.ts`、`harness/harness-capabilities.ts` 与 `harness/index.ts`。原路径保留兼容 re-export，9 处消费者零改动。 |
| **B1** `chat-store/helpers/chat-helpers.ts` 搬迁 | ✅ 完成 | 从 `stores/chat-helpers.ts` 搬到 `stores/chat-store/helpers/chat-helpers.ts`，与 codex/event/provider-routing helpers 同目录。 |
| **B2** `chat-store/types.ts` 真迁 | ✅ 完成 | PerSessionState/ProjectState/ActiveSessionView/ChatStore/ToolRendererState/PersistedSessionState/Mention/MiniAppContextSlot/SubagentColor/Corner/ChatProvider/SUBAGENT_COLOR_POOL 全部物理迁到 types.ts；index.ts 改为 import + re-export。 |
| **B3** `chat-store/defaults.ts` 真迁 | ✅ 完成 | createSessionId / createDefaultPerSessionState / createDefaultProjectState / getDefaultEffortForModel / freshSubagentColorPool 物理迁到 defaults.ts；cache-dependent invalidators 仍 re-export from index.ts（私有 cache 状态留在 index.ts）。 |
| **E** `chat.ts` 薄壳化 | ✅ 完成 | 主体物理搬到 `chat-store/index.ts`；`chat.ts` 仅一行 `export * from './chat-store'`。`chat-store.test.ts` 等消费者 import 路径零改动。 |
| **D-1** `chat-store/harness/` handler 文件 | ✅ 完成 | HarnessHandler 接口 + applyClaudeResources + applyCodexResources 拆到 harness/{harness-handler,claude-handler,codex-handler}.ts；handler dict 用 closure 注入 cache-helpers。 |
| **D-2** harness-capabilities.ts | ✅ 完成 | 静态能力表（supportsMcp/Plan/Todos/Subagents/Compact/StreamingToolInput + displayName），消费点逐步从 `provider === 'codex'` 散点 switch 迁过来。 |
| **D-3** `chat-store/slices/tool-slice.ts` | ✅ 完成 | toolRenderers / _pendingStandaloneCalls / _bashOutputs state + 5 个 tool-intercept action。 |
| **D-4** `chat-store/slices/claude-slice.ts` | ✅ 完成 | setSelectedModel / setSelectedEffort / setFastMode（含 permission-mode auto-downgrade 副作用）。 |
| **D-5** `chat-store/slices/codex-slice.ts` | ✅ 完成 | setSelectedCodex(Model/ReasoningEffort/PermissionPreset/CollaborationMode) + refreshCodexModels（stale-while-revalidate）+ refreshCodexSkills。 |
| **D-6** `chat-store/slices/session-slice.ts` | ✅ 完成 | rewind 4 个 + queue 2 个 + setDraftText + assignSubagentColor + setDetailedUsage + removeSessionFromMemory。 |
| **D-7** `chat-store/slices/core-slice.ts` | ✅ 完成 | 20 个 UI toggle/setter：isOpen、corner、attachments、mentions、miniAppContexts、userSelections、todos panel、provider/mcp popup、showDir/ReviewPanel、focusRestore nonce、slashCommandOutput 等。 |
| **D-8** `chat-store/slices/event-slice.ts` | ⚠️ 部分完成 | 含 `syncLiveSnapshots`（已迁）。**handleAgentEvent (~390 行) 仍在 index.ts**——它依赖 6 个未导出 module-level helper（applyEventToSession / _hydrateSessionState / addRemoteSession / removeRemoteSession / markMessageEventApplied / persistStreamingToolInput），搬迁需先逐个抽 helper，属独立 PR 量级。 |

### 目录分层完成度

对照"目标分层"图：

| 目标节点 | 现状 |
|---|---|
| `packages/shared/harness/harness-id.ts` | ✅ canonical re-export |
| `packages/shared/harness/harness-capabilities.ts` | ✅ 静态能力表 |
| `packages/shared/harness/harness-brand.ts` | ✅（已迁入 + 原路径 re-export） |
| `stores/chat-store/index.ts` | ✅ store body |
| `stores/chat-store/types.ts` | ✅ 真源头（所有 interface/type 物理在此） |
| `stores/chat-store/defaults.ts` | ✅ 真源头（cache-free 工厂函数物理在此） |
| `stores/chat-store/slices/tool-slice.ts` | ✅ |
| `stores/chat-store/slices/claude-slice.ts` | ✅ |
| `stores/chat-store/slices/codex-slice.ts` | ✅ |
| `stores/chat-store/slices/session-slice.ts` | ✅ |
| `stores/chat-store/slices/core-slice.ts` | ✅ |
| `stores/chat-store/slices/event-slice.ts` | ⚠️ 部分（syncLiveSnapshots 已迁；handleAgentEvent 待 helper 先抽） |
| `stores/chat-store/harness/{harness-handler,claude-handler,codex-handler,index}.ts` | ✅ |
| `stores/chat-store/helpers/{chat,codex,event,provider-routing}.ts` | ✅ |
| `stores/chat.ts` 薄壳 | ✅ |
| `components/chat/model-selector/` | ✅ |
| `components/chat/{permission-prompt,chat-message,chat-input,chat-status-bar}/` | ⏸ 评估为不适合机械拆分（散点/穿插式），拆完 95% 重复；更合理的方向是抽 hook（`useChatInputSlashRouting` 等），不是组件拆分。 |

**骨架完成度：~95%**。剩余两项不是"目录还没建"级别，而是"真函数搬迁需先抽 helper"级别：

1. **`handleAgentEvent` 抽到 event-slice**：依赖 6 个未导出 module helper，需先各自抽一道，再搬主函数。属于专门的"event-pipeline cleanup" PR。
2. **UI 4abc/4e**：目录可以建，但内容会是 95% 重复——所以更合理的是把它们改造成 hook 形式（`useChatInputSlashRouting` 等）而不是组件拆分，已写入 plan 的"决策清单"作为约束。

### 关键教训（写入下次类似 refactor 的预算清单）

1. **"假通用"组件的拆分价值差异巨大**：要看 codex 分支是 *末端集中*（可拆）还是 *穿插式 / 散点式*（拆完两份 95% 代码重复，得不偿失）。审计阶段须给每个组件标这个属性。
2. **slice 拆分不是 zero-cost**：zustand slice 模式书面上简洁，实际上 slice 间 cross-reference 比理论多。在不重写业务的前提下，仅为"文件物理拆分"做 slice，性价比低。
3. **纯函数外提 + helper 路由 = 高 ROI**：阶段 1 / 2 改动小、零行为变化、立即收益（chat.ts 减重、provider switch 收敛、可独立单测的 helpers）。是最值得做的阶段。
4. **HarnessId 统一 + ChatProvider 兼容 alias = 不破坏现有代码的渐进式 rename 起点**。后续如有大量改动顺手把 `ChatProvider` 替换为 `HarnessId` 即可，不需要单独 rename PR。
5. **facade 优先于真迁**：types.ts / defaults.ts 的 facade 模式让公开 API 路径立刻稳定，源头迁移可以延后到 "私有依赖也迁完" 那一刻；同时避免 TS2484 双重定义错误。
6. **vitest 必须从 `apps/desktop` cwd 启动**：根目录没有 vitest 配置；从根跑会让 `@/*` alias resolution 失败但错误信息很容易被误读为 "我刚才改坏了"。手动测试时 `cd apps/desktop` 或者用 `bunx vitest --config apps/desktop/vitest.config.ts`。

## 现状诊断

### chat.ts (5119 行) 内部分布

| 段 | 行号 | 性质 |
|---|---|---|
| 类型 + 字面常量 | 1-100 | 通用，可外提 |
| `PerSessionState` 接口 | 103-170 | **字段已物理分离** (claude vs codex) |
| `ProjectState` 接口 + defaults | 171-368 | claude/codex 字段混在一起 |
| `ChatStore` 接口 | 379-657 | 通用 + claude + codex actions 全混杂 |
| Codex 纯函数 | 657-2059 | upsert/remove/accumulate/parse/format，全部可外提 |
| `HarnessHandler<H>` + 实现 | 2503-2574 | **仅 resources 抽象，未覆盖 lifecycle/event/send** |
| `useChatStore` body | 2576-5009 | 巨型 reducer，含 `handleAgentEvent` (2675-3068) 和 `applyEventToSession` (794-1400+) |
| selectors | 5105-5119 | 已经按 claude/codex 命名分离 |

**关键发现：** state 字段层面 Claude/Codex 已经分离 (`selectedModel` vs `selectedCodexModel`、`todos` vs `codexUsageSnapshot`)，不是历史遗留的命名冲突。混乱主要在 **action 实现没分** + **provider switch 散落 37+ 处** + **`handleAgentEvent` 单方法过大**。

### 双 harness UI 现状

| 类别 | 数量 | 代表 |
|---|---|---|
| Codex 专属 | 13 | `Codex*.tsx`, `codex-*.tsx` |
| Claude 专属 | 5 | `PlanApprovalPrompt`, `TodoListPanel`, `TodoPopup`, `SubagentBlock`, `SubagentFullView` |
| **假通用 (内部 if-switch)** | **5** | `ModelSelector` (50%), `PermissionPrompt` (12%), `ChatInput` (12%), `ChatMessage` (10%), `ChatStatusBar` (8%) |
| 真通用 | 48 | `CopyableMarkdown`, `MentionPopup`, `ContextUsage` ... |

注：`AskUserQuestionPrompt` 是真通用 (Codex 把答案包成 codex_item)，不归 Claude 专属。

### 现有抽象层

- **`HarnessId` 实际有三份来源**，统一时不能新建第四份，必须让前两处 re-export canonical：
  - `packages/shared/src/agent-types.ts:1229` — `export type HarnessId = keyof HarnessResourcesMap`（**chat.ts 实际 import 的就是这份**）
  - `packages/shared/src/session-types.ts:3` — `export type HarnessId = 'claude' | 'codex'`（字面 union）
  - `apps/desktop/src/renderer/src/stores/chat.ts:14` — `export type ChatProvider = 'claude' | 'codex'`（renderer-local 别名）
- `HarnessHandler<H>` (chat.ts:2503) 只有 `{ connect, apply }`，没有 `applyEvent / send / getDefaultModel / capability flags / displayName`。
- `harness-brand.ts` 抽象了主题色，但漏 default model / supportsMcp / displayName。**重要：现有代码用绝对路径 `@superone/shared/harness-brand` 引用，移动后必须保留兼容 re-export。**
- IPC 命名不对称：Codex 走 `codex:*` 显式 channel (25+)，Claude 走 SDK subprocess 隐式。

---

## 目标分层

```
┌─ packages/shared/
│   ├─ harness/                          (新) harness 元数据 + capability
│   │   ├─ harness-id.ts                 HarnessId 唯一来源，删 ChatProvider
│   │   ├─ harness-capabilities.ts       (新) supportsMcp/Plan/Todo/Subagent ...
│   │   └─ harness-brand.ts              (移动) 已有
│   └─ agent-types.ts                    (维持)
│
├─ apps/desktop/src/renderer/src/stores/
│   ├─ chat-store/                       (新目录，避免与 chat.ts 同名解析冲突)
│   │   ├─ index.ts                      顶层 createStore + 合 slice
│   │   ├─ types.ts                      PerSessionState / ProjectState / ChatStore 接口
│   │   ├─ defaults.ts                   createDefault* + invalidate*Cache
│   │   ├─ slices/
│   │   │   ├─ core-slice.ts             通用 actions (send/interrupt/reset/nav)
│   │   │   ├─ claude-slice.ts           Claude 专属 (setModel/Effort/Fast/Todo)
│   │   │   ├─ codex-slice.ts            Codex 专属 (approve/reject/refreshModels/refreshSkills/setMode...)
│   │   │   ├─ event-slice.ts            handleAgentEvent 中心 pipeline + cross-cutting hooks
│   │   │   ├─ session-slice.ts          focusProject/ensureSession/sync/persist
│   │   │   └─ tool-slice.ts             toolRenderers + bashOutputs
│   │   ├─ harness/
│   │   │   ├─ harness-handler.ts        扩展接口 + claudeHandler/codexHandler
│   │   │   ├─ claude-handler.ts         applyClaudeResources + Claude pre/post hooks
│   │   │   └─ codex-handler.ts          applyCodexResources + Codex pre/post hooks
│   │   └─ helpers/
│   │       ├─ chat-helpers.ts           (已有，扩充) buildSlashCommands/extractMode/checkpoint
│   │       ├─ codex-helpers.ts          (新) upsertCodexItem/removeCodexItem/accumulateFooter/parseCommand/formatAuth
│   │       └─ event-helpers.ts          (新) extractSessionTitle + 其他事件路由 helper（applyDelta/mergeMessagesByMaxSeq 已有测试覆盖，搬过来即可）
│   └─ chat.ts                           (薄壳，一行) `export * from './chat-store'`
│                                          这样 chat-store.test.ts 的 `import from '../stores/chat'` 零改动
│
└─ apps/desktop/src/renderer/src/components/chat/
    ├─ model-selector/
    │   ├─ ModelSelector.tsx             (薄路由) 按 provider 渲染下面之一
    │   ├─ ClaudeModelSelector.tsx       (从原 ModelSelector 116-184 抽出)
    │   └─ CodexModelSelector.tsx        (从原 ModelSelector 186-238 抽出)
    ├─ permission-prompt/
    │   ├─ PermissionPrompt.tsx          (薄路由)
    │   ├─ ClaudePermissionPrompt.tsx
    │   └─ CodexPermissionPrompt.tsx
    ├─ chat-message/
    │   ├─ ChatMessage.tsx               (薄路由) 末端按 providerId 二选一
    │   ├─ ClaudeMessageView.tsx
    │   └─ (Codex 复用现有 CodexTurnView.tsx)
    ├─ chat-input/
    │   ├─ ChatInput.tsx                 (主体保留)
    │   ├─ use-chat-input-slash-routing.ts  (新 hook，封 12% Codex 分支)
    │   └─ use-chat-input-commands.ts        (新 hook，封 /plan /review /goal 路由)
    └─ chat-status-bar/
        ├─ ChatStatusBar.tsx             (主体保留)
        ├─ ClaudeStatusBarTail.tsx       (sandbox + permission)
        └─ CodexStatusBarTail.tsx        (CodexPermissionSelector)
```

每个文件 < 700 行，大文件可控。

---

## 阶段拆解 (按风险递增 + 依赖前置)

### 阶段 0：基础设施 (零行为变化，1 PR)

1. **统一 `HarnessId` canonical source** — 选 `agent-types.ts:1229` 的定义作为唯一来源（因为它由 `HarnessResourcesMap` 推导，最贴合代码语义；session-types.ts 那份是历史遗留），把 `session-types.ts:3` 改为 `export type { HarnessId } from './agent-types'` 兼容 re-export。`chat.ts:14` 的 `ChatProvider` 改为 type alias `export type ChatProvider = HarnessId`，下一阶段再批量改名。
2. **跑全量 baseline**：`bun run test`、`bun run typecheck`、`bun run build-storybook`，保留输出做对比基准。
3. **不动 chat.ts 主体**，**不预建 capability 表**（capability 按阶段 5 的实际消费点再迁，不为未来 harness 预抽）。

**验证**：type pass + `chat-store.test.ts` (6547 行) 全绿 + Storybook build pass。

---

### 阶段 1：纯函数外提 (低风险，1-2 PR)

把 `chat.ts` 里的纯函数搬到 `stores/chat/helpers/*`，**保留原 export 路径作 re-export**：

| 函数 | 现在行号 | 目标文件 |
|---|---|---|
| `upsertCodexItem`, `removeCodexItem` | 657, 665 | `codex-helpers.ts` |
| `accumulateCodexFooterTokens`, `findLatestCodexUsage` | 739, 754 | `codex-helpers.ts` |
| `parseCodexCommand`, `formatCodexAuthStatus` | 1962, 2024 | `codex-helpers.ts` |
| `getLatestCodexThreadId`, `resolveCodexReasoningEffort`, `resolveCodexModelSelection` | 2035, 2045, 2059 | `codex-helpers.ts` |
| `extractSessionTitle` | 1590 | `event-helpers.ts` |
| `mergeMessagesByMaxSeq`, `applyDelta` | 5040, 5065 | `event-helpers.ts` |
| `getDefaultEffortForModel` | 272 | `helpers/defaults.ts` |

每个函数迁移后 `chat.ts` 仍 `export { ... } from './chat-store/helpers/codex-helpers'`，**消费方不需要改 import**。

测试现状（不要当成"补空白"）：
- `chat-codex-helpers.test.ts:278` 已覆盖 `applyDelta`
- `chat-store-live-sync.test.ts` 已覆盖 `mergeMessagesByMaxSeq`
- 迁移时把对应测试 import 路径改到新位置，**不需要重写测试**。新增 `event-helpers.test.ts` 仅用来本地化新文件的就近测试（搬已有用例 + 必要时补 `extractSessionTitle` 等没测的角落）。

**预计减重**：chat.ts 减 ~600 行 → 4500 行。

---

### 阶段 2：收敛 provider switch（不动 event pipeline 主导权，中风险，1 PR）

**前提认知**：`handleAgentEvent` 不只是 harness 分发，它还承担：
- 全局/cross-cutting 事件：`remote_session_start/end`（chat.ts:2676）、`provider_changed`（2712）、`session_title_changed`（2726）、`agent_setting_change` 的 project-level `sandboxInfo`（2766）
- lazy session / fallback active session 路由（2775+）
- init_ready project state 更新、trace、save/evict、unseen 标记 等通用副作用

如果让 handler "先吃 event，返回 null 才 fall through"，**事件顺序很容易漂移**——这正是审核指出的隐患。本阶段改为更保守的做法：

**做法 A：抽 helper 而不是抢 pipeline**

新增 `chat-store/harness/` 下的两个 handler，**只暴露 pure helpers**（不接 pipeline 主导权）：

```ts
interface HarnessHandler<H extends HarnessId> {
  // 已有
  connect(): Promise<HarnessResourcesMap[H]>
  apply(state, resources): Partial<ChatStore>

  // 新增 pure helpers，event pipeline 在需要时点名调用，handler 不抢 control flow
  resolveDefaultSelections(session, resources): Partial<PerSessionState>
  shouldEvictOnIdle(session): 'sync' | 'async' | 'never'
  shouldTraceEventType(eventType): boolean
  parseSlashCommand?(input): ParsedCommand | null
  getCopyableText?(message): string | null
}
```

**关键约束**：handler **没有** `applyEvent` 方法。事件主路径保持中心化在 `event-slice.ts`，只在已识别的 hook 点上向 handler 询问"该不该 trace / 该不该 evict / 默认选择是什么"。

**做法 B：先抽通用 helpers 把 37 处 switch 拆掉**

把散落的 `provider === 'codex'` 收敛成 3 个工具函数（放在 `chat-store/helpers/provider-routing.ts`）：

```ts
resolveProvider(session): HarnessId               // 替代 5+ 处 `sessionProvider ?? preferredProvider ?? DEFAULT`
selectModelField(session): { id, kind }            // 替代 model/effort 字段二选一的散落 if
inferProviderFromHarnessId(harnessId): HarnessId   // 替代 `harnessId === 'codex' ? 'codex' : 'claude'` 这种重复表达
```

具体替换点（按收益从高到低）：

| chat.ts 行 | 现状 | 替换为 |
|---|---|---|
| 559, 1204, 3094, 4389 | `sessionProvider ?? preferredProvider ?? DEFAULT` | `resolveProvider(session)` |
| 320, 565 | `triggerPrewarm` 内 model 字段选择 | `selectModelField(session)` |
| 2679-2683, 3094 | `event.harnessId === 'codex' ? 'codex' : ...` | `inferProviderFromHarnessId(event.harnessId)` |
| 1939 | `approveCodexPlan` guard | 留在 codex-slice，不抽 |
| 2913 | trace 分支 | `handler.shouldTraceEventType(event.type)` |
| 3004-3027 | evict 异步/同步分歧 | `handler.shouldEvictOnIdle(session)` |
| 3875 | rewind provider check | 留在 codex-slice，本身就是 codex 专属 action |
| 4250 / 4279 / 4512 | createSession provider 分支 | 留在 session-slice 内部，handler 不接 |

**风险与缓解**：
- 不动 `handleAgentEvent` 内部结构，event 顺序由测试 baseline（`chat-store.test.ts` 6547 行）兜底。
- 每个 helper 替换后单独 commit + run test。

**预计减重**：chat.ts 减 ~300 行 → 4200 行。switch 数量从 37 降到 ~15（剩余的都是真正 harness-specific 的 action 内部逻辑，留在 slice 内合理）。

> **审阅反馈采纳点**：原计划让 handler 接管 event 主路径，被指出会改 event 顺序。本阶段改为只抽 helpers，pipeline 主导权留在 event-slice。

---

### 阶段 3：`useChatStore` slice 拆分 (中风险，1-2 PR)

用 zustand slice 模式 (无需引入 immer / middleware，本项目目前不用)：

```ts
// stores/chat/index.ts
export const useChatStore = create<ChatStore>()((set, get, store) => ({
  ...createCoreSlice(set, get, store),
  ...createClaudeSlice(set, get, store),
  ...createCodexSlice(set, get, store),
  ...createEventSlice(set, get, store),
  ...createSessionSlice(set, get, store),
  ...createToolSlice(set, get, store),
}))
```

每个 slice 文件签名：

```ts
// slices/codex-slice.ts
export const createCodexSlice: StateCreator<ChatStore, [], [], CodexSlice> =
  (set, get) => ({
    approveCodexPlan: async () => { /* 现 chat.ts 1939-1953 */ },
    rejectCodexPlan: async (feedback) => { /* ... */ },
    setSelectedCodexModel: (model) => { /* ... */ },
    refreshCodexModels: async (force) => { /* ... */ },
    refreshCodexSkills: async (project) => { /* ... */ },
    // ... 其他 codex 专属 actions
  })
```

**消费方零改动**：`useChatStore((s) => s.approveCodexPlan)` 依然能拿到。

**拆分顺序** (按耦合度从低到高)：

1. `tool-slice` (toolRenderers / bashOutputs) — 跟其它字段几乎不交叉，先拆最安全
2. `claude-slice` (setSelectedModel / Effort / Fast / refreshClaude*)
3. `codex-slice` (Codex 专属 actions)
4. `session-slice` (focusProject / ensureSession / sync / persist / rewind)
5. `core-slice` (sendMessage / interrupt / reset / agentTitles)
6. `event-slice` (handleAgentEvent / applyEventToSession)

每个 slice 拆完跑一次 test 再走下一个。

**预计**：chat.ts 变成一行 re-export，`chat-store/index.ts` 装配 slice。**行数是参考不是硬指标**——`event-slice` 因为承载 `handleAgentEvent` + `applyEventToSession` 主体，实际可能 800-1000 行，不要为了压到 700 行制造过度抽象。Slice 的目标是按职责切分，不是按行数切分。

---

### 阶段 4：UI 假通用组件分裂 (中风险，4 PR)

每个组件独立 PR，顺序按改动量从小到大：

**4a. `ChatStatusBar` (578 行，8% 分支)**

- 抽 `ClaudeStatusBarTail.tsx` (含 `SandboxModeSelector` + `PermissionModeSelector`)
- 抽 `CodexStatusBarTail.tsx` (含 `CodexPermissionSelector`)
- `ChatStatusBar.tsx` 内联 `provider === 'codex' ? <CodexTail/> : <ClaudeTail/>`，其余通用

**4b. `PermissionPrompt` (660 行，6 个 switch 点)**

- 抽 `ClaudePermissionPrompt.tsx` (2 按钮 Allow/Deny)
- 抽 `CodexPermissionPrompt.tsx` (4 按钮 + Feedback，带不同快捷键)
- `PermissionPrompt.tsx` 变薄路由，公共 hooks (`useShortcuts`, `usePermissionState`) 抽到 `permission-prompt/hooks.ts`

**4c. `ChatMessage` (876 行，10% 但集中在末端)**

- 抽 `ClaudeMessageView.tsx`，沿用 `CodexTurnView.tsx`
- `ChatMessage.tsx` 末端 (568-626) 改为 `message.providerId === 'codex' ? <CodexTurnView/> : <ClaudeMessageView/>`
- 复制文本提取 (`getCopyableText`) 用 handler 抽象：`harnessHandlers[provider].getCopyableText(message)`

**4d. `ModelSelector` (239 行，50% 分支!)**

- 收益最大：拆成 `ClaudeModelSelector.tsx` (115-184) + `CodexModelSelector.tsx` (186-238)
- `ModelSelector.tsx` 薄到 30 行，只看 provider 选其一
- Codex 加载 Effect 移到 `CodexModelSelector.tsx`

**4e. `ChatInput` (1229 行，12% 分支)** — *可选，改完上面再决定*

- 抽两个 hook：`useChatInputSlashRouting` (slash list 选择) + `useCodexCommandHandling` (/plan /review /goal)
- 主体 `ChatInput.tsx` 改用 hooks，内部不再 `if (provider === 'codex')`

每个 PR 后跑 `ChatInput.test.tsx`、`PermissionPrompt.integration.test.tsx`、`ChatStatusBar.test.ts`、Storybook smoke test。

---

### 阶段 5：扫尾 (低风险)

1. 删除 `ChatProvider` 别名，全代码改为 `HarnessId`
2. `default model / displayName / capabilities` 从 `chat.ts` 散落常量迁到 `harness-capabilities.ts`
3. `AskUserQuestionPrompt` 验证双 harness 用例，可能不动
4. 整理 selectors：`selectClaudeXxx` 和 `selectCodexXxx` 移到 `stores/chat/selectors.ts`

---

## 风险点 / 决策清单

1. **`chat-store.test.ts` (6547 行) 是关键依赖**。它直接 `import { useChatStore } from '../stores/chat'` — 阶段 1 的 re-export 必须保持，阶段 3 之后 `stores/chat.ts` 仅 `export * from './chat-store'`，测试零改动。
2. **避免 `chat.ts` 与 `chat/` 同名解析冲突**。所以本计划新建目录用 `chat-store/`（不是 `chat/`），原 `chat.ts` 保留作薄壳 re-export。
3. **`sessionProvider === null` 的兜底散布 5 处** (chat.ts 559, 1204, 3094, 4389...)。阶段 2 抽 `resolveProvider(session)` 集中，下游假设永不为 null。
4. **`handleAgentEvent` 顺序不能动**。原计划让 handler 接管事件主路径，存在改变事件顺序的风险——本计划阶段 2 已改为 helper-only，不抢 pipeline。每次重构后用 `event-trace.db` 抓 baseline 对比关键 message 的 event 序列。
5. **harness-brand re-export 兼容**。若把 `harness-brand.ts` 从 `packages/shared/src/` 移到 `packages/shared/src/harness/`，需要在原路径保留 `export * from './harness/harness-brand'`，避免散落 30+ 处 import 全改。
6. **Storybook 验证用现有命令**。验证表里的 "Storybook smoke" 指 `bun run build-storybook`（已存在，root + apps/desktop 都注册了）能跑通且无 build error；不是某个独立的 smoke 脚本。阶段 4 抽 ClaudePermissionPrompt / CodexPermissionPrompt 时记得给新组件加 stories，旧 `PermissionPrompt.stories.tsx` 改写或保留作 router-level demo。
7. **不要预先抽 capability 检查**。能力 flag 现在只有 ~5 处真的需要 (`supportsTodos`, `supportsPlanMode`, `supportsMcp`)，按阶段 5 实际消费点再迁，不为"将来加 harness"预抽空表。
8. **避免引入 immer / middleware**。zustand slice 模式可以不用 middleware；保持现有 set/get 风格。
9. **PR 粒度**：11 个 PR (0 / 1a / 1b / 2 / 3a-f / 4a-d / 5)，每个独立可 review。不要合成一个大 PR，review 不动。
10. **手动 verify 必跑场景** (每个阶段后)：
    - Claude 发消息 + permission prompt + 切 model + cycle permission mode
    - Codex 发消息 + plan approval + reject with feedback + 切 model/effort/preset
    - 切换 project + 切换 session + 切 harness (preferredProvider)
    - rewind + fork session
    - mini-app 触发 AskUserQuestion (Claude + Codex 都试)

---

## 不在本计划范围

- `ToolBlock.tsx` (1271 行) 拆分 — 跟 harness 关系不大，是另一个 refactor 议题
- `ChatInput.tsx` 主体的 Tiptap 重构 — 太大独立做
- IPC 命名对称化 (`claude:*` 前缀) — 跨 process 改动，推迟
- main 进程 (`apps/desktop/src/main/agent/*`, `codex-experiment-service.ts`) 重构 — 不在 renderer 范围

---

## 验证策略

| 阶段 | 必跑 | 选跑 |
|---|---|---|
| 0 | `bun run test`、`bun run typecheck`、`bun run build-storybook` | — |
| 1 | 同上 + 新 `event-helpers.test.ts` | — |
| 2 | 同上 + 手动 verify 完整列表 | `event-trace.db` 抓 baseline 对比 |
| 3 | 同上 + `chat-store-live-sync.test.ts` | trace DB 对比 event 顺序 |
| 4 | 同上 + `bun run build-storybook` + `PermissionPrompt.integration.test.tsx` | 手动 verify ChatStatusBar/ModelSelector 视觉 |
| 5 | 全量 + alpha build 烟测 | — |

**Stop 条件**：阶段 3 之后 chat.ts 主体未拆成 slices（仍 > 3000 行） → 重新审视 slice 边界；阶段 4 之后 `ModelSelector` 没掉到 < 50 行 → 抽象失败，回滚。

---

## 投入估算

- 总工时：**~10-15 工作日**
- PR 数：**11 个**
- 最大单 PR：阶段 3 的 event-slice 拆分 (~800 行变动)，其余都在 < 400 行
- 可中断、可回滚，每阶段独立验证

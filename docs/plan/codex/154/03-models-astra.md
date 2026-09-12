# 03. 动态模型目录与 Astra 真实回合

状态：[PLANNED]

## 目标

用 0.154 的 `model/list` 作为唯一有效目录。GPT-6-Astra 是否出现取决于 **账户 / provider entitlement**，不能保证每个 ChatGPT 账号或自定义 provider 都有。SuperOne **不要硬编码** Astra。

完整的 `modelProvider/capabilities/read` 动态能力仍归 [03-model-capabilities](../147/03-model-capabilities.md)，本轮不重做。但本轮必须把 **model + effort + service tier** 一起验证：当前 response adoption 只读 `model`。

Release note 里「fresh session / fork 用 server 模型默认值」（#43177、#43355）是 **TUI 客户端** 改动，不是新的 app-server 默认规则。不要据此让 SuperOne 无条件省略 `model`。

## 当前能力

- Desktop：[`codex-experiment-service.ts`](../../../../apps/desktop/src/main/codex/codex-experiment-service.ts) 调 `model/list`，按 provider/credential 缓存。
- Renderer 已有 Astra retention 测试（`gpt-6-astra` fixture），说明 UI 能接这个 id，不证明所有账号都有。
- CLI 静态回退 [`DEFAULT_CODEX_MODELS`](../../../../apps/cli/src/provider/resolve-service.ts) 仍是 `gpt-5.2` / `gpt-5.1` / `o3`。只在无法向 harness 问目录时使用，**不能当有效默认模型来源**。

## 实现设计

1. 升到 0.154 后，对 ChatGPT 账号和 Bedrock/自定义 provider 各打一次 `model/list`。记录是否包含 Astra、default 标记、effort、input modalities、service tier。没有 Astra 算 entitlement，不是升级失败。
2. **明确的 SuperOne 用户选择**（会话已选 / 用户刚点的模型）在 `thread/start` / `turn/start` 继续显式传，effort / service tier 跟同一选择来源走。
3. **无明确选择时保留服务端默认解析**：省略 `model`（以及未选的 effort/tier），采用 thread/turn 响应里的实际值；或先 `config/read`，仅当配置 model 为空时才用 `model/list` 的 catalog default。禁止无条件把 picker/list default 写成 start 参数——那会覆盖 Codex `config.model`（0.154 `session/mod.rs` 把它交给模型解析器；`models-manager` 优先保留该值；TUI 也只在配置 model 为空时才用 catalog default）。省略 `model` 是合法的现有 app-server 行为，不是「赌 TUI 默认」。
4. CLI 静态表可以补 Astra 当离线 fallback 文案，但无探测路径必须标明 stale，且不得用该表覆盖 live `model/list` 或服务端 `config.model`。
5. 旧会话钉在已下架模型上时，沿用现有 retention：保留当前会话选择。新会话无明确选择时走服务端默认，不用静态表。
6. Astra 在 `models-manager/models.json` 上带运行策略（`code_mode_only`、multi_agent v2、`node_repl_auto_review_required`）。有 entitlement 时做 **真实回合**，不要只测菜单行：
   - SuperOne host MCP 工具（至少一次成功调用）
   - 审批 allow 与 deny
   - async question（含 `questions: null` 的 attention-only，见 [02](./02-protocol-compat.md)）
   - 子任务 / reviewer 事件
   - cold resume

## UI/UX

- Composer 模型菜单用 app-server 给的 name/description。
- 不支持的 effort / 图片输入：禁用并给原因。
- 刷新失败保留上次缓存，标“可能过期”。
- 无 Astra 的账号不显示假行。

## 验收

- 有 entitlement 的 ChatGPT 账号：`model/list` 含 Astra；**用户选中后** start/turn 带该 model id，effort/tier 与该选择一致。
- 无明确选择：请求省略 `model`（或 config 为空才用 list default）；响应里的实际 model/effort/tier 被采用，不被 picker default 覆盖。
- 无 entitlement / 自定义 provider：目录不被官方 Astra 行污染。
- 静态回退表不是 live 默认值来源，也不覆盖 `config.model`。
- 有 Astra 时上述真实回合与 cold resume 通过。
- 现有 `codex-model-retention` / `codex-custom-provider-models` 测试仍绿。

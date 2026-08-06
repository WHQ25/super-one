# known-issues(bug 台账)

> 装什么:本仓被证实的代码实现错误,一条一块,append-only,发生/证实时直接记。
> 格式:标题=日期·对象·动作;正文=错误 / 正解 / RCA。
> 未修复的条目标 `状态: 未修复`,修完补 `状态: 已修复 <commit>`。

## 2026-08-07 · 远程节点 claude turn · root 下用 bypassPermissions 起 SDK 进程

- 状态: 已修复(见 `packages/claude/src/root-permission-guard.ts`)
- 错误: 节点以 root 运行(`superone start --home ~/.superone/node`)时,桌面端会话权限模式为 `bypassPermissions`,每轮 turn 的 claude 子进程刚启动即 `exit(1)`,stderr 为 `--dangerously-skip-permissions cannot be used with root/sudo privileges for security reasons`。表现为桌面端发消息无回复;`superone harness doctor claude` 仍报 `enable=true, ready=true`,filetree 正常。证据:`~/.superone/node/state.sqlite` 的 `environment_events` 两次 `session.turn_error`(2026-08-06 19:31、2026-08-07 00:44),`sessions.status=error`。
- 正解: `apps/cli/src/session/claude-turn-runner.ts` 在 `process.getuid?.() === 0 && permissionMode === 'bypassPermissions'` 时降级权限模式并回一条可见提示;或节点改用非 root 用户运行。容器内可设 `IS_SANDBOX=1` 跳过该守卫,等价于 root 下关闭权限保护,仅隔离环境适用。
- RCA: Claude Code 二进制内置守卫在 `getuid() === 0 && IS_SANDBOX !== '1' && !CLAUDE_CODE_BUBBLEWRAP` 时拒绝跳过权限提示的启动参数。触发条件有两个而不是一个:`permissionMode === 'bypassPermissions'`,以及 `allowDangerouslySkipPermissions: true` ——后者 `ClaudeLiveSession` / `runClaudeSdkTurn` 是无条件设的,所以 root 节点上**任何权限模式**的 turn 都会失败,不止选了绕过的。实测矩阵见 `packages/claude/src/root-permission-guard.test.ts` 文件头。权限模式由桌面端每轮随 `session.send` 下发(`send-message.ts:447`),经 `session-runtime.ts` 透传到 `ClaudeLiveSession.open`,节点侧无 uid 相关校验。`harness doctor` 只探二进制存在与可执行(`harness-cli.ts:540` `doctorOne`),不跑真实 turn,因此健康检查结果与该失败正交。

## 2026-08-07 · node-session-event-map · turnError 在无 assistant 块时被丢弃

- 状态: 已修复
- 错误: `packages/shared/src/node-session-event-map.ts:458` 的 `turnError` 分支仅在 `lastAssistantId` 非空时 push `message_error`。turn 在产出任何 delta 之前失败(如上一条的进程启动即退出)时,只 push `status_change: error`,桌面端界面无任何错误文案,表现为"没有回复"。
- 正解: `turnError` 分支在无 assistant 块时先 `ensureAssistant(push)` 再 push `message_error`,保证启动期失败在界面可见。
- RCA: 事件映射假定错误总发生在消息流中途,未覆盖"turn_started 后直接 turn_error"这条路径。该假定使一类失败静默,排查必须落到节点 sqlite 事件表才能看到原因。

## 2026-08-07 · harness.resources 模型目录 · 远程会话返回静态默认表

- 状态: 已修复(`probeModels` 钩子 + `apps/cli/src/session/claude-model-catalog.ts`)
- 错误: 远程节点会话的模型列表与主机 `claude` CLI `/models` 不一致,显示 Sonnet 4.5 / Opus 4.5 / Haiku 4.5。这三项来自 `apps/cli/src/provider/resolve-service.ts:193` 的 `DEFAULT_CLAUDE_MODELS`,在节点无 provider 凭据时无条件回落(实测节点 `provider_credentials`、`provider_bindings` 均 0 行)。同一主机上直接调 SDK `supportedModels()` 返回 `default / opus[1m] / claude-fable-5[1m] / sonnet / haiku`,即主机凭据的真实目录可取,只是这条链路不取。
- 正解: `packages/runtime/src/session/harness-resources.ts` 增加 `probeModels` 钩子,`apps/cli/src/rpc/harness-resources-handlers.ts` 传入等价于桌面 `fetchModels`(`apps/desktop/src/main/agent/claude-models.ts:7`)的 SDK 探测并加缓存;无 ProviderStore 凭据时用探测结果而非静态表。
- RCA: `listHarnessModels` 只有"ProviderStore 凭据 → 静态默认表"两条路径,缺"探测节点上真实 harness 能力"这条。同源缺口:`harness-resources.ts` 已定义的 `probeAccount` / `probeSlashCommands` / `probeOutputStyles` 三个钩子全仓无调用方传值,远程会话的 account、slashCommands、outputStyles 同样为空。静态兜底表在无凭据时与真实目录无法区分,读者会把它当作探测结果。

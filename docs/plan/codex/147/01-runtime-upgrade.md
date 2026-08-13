# 01. Codex 0.147 Runtime 升级

状态：[VALIDATED LOCALLY]

## 目标

把桌面、CLI/远程节点和预取/发布清单统一到 `@openai/codex` `0.147.0`，并以该版本生成的 App Server schema 作为协议审查基线。

## 集成范围

- `apps/desktop/package.json` 与 `bun.lock`。
- `packages/runtime/src/harness/managed-official.ts` 的官方 pin。
- 远程节点的 managed harness manifest、预取和发布产物。
- `packages/codex` 与桌面 App Server 连接层的协议兼容测试。

## 实现步骤

1. 已更新 manifest、managed pin 和 lockfile 到 `0.147.0`，并用 `bun install --frozen-lockfile` 安装验证。
2. 已运行 `codex app-server generate-json-schema --experimental` 审查 Skills/Hooks/MCP 的 0.147 参数。
3. 对比 0.146.1/0.147.0 的 request、notification、server request；记录新增的 Thread Sections。
4. 更新 managed harness pin 和发布 manifest 生成测试。
5. 远程节点只接受同版本或明确兼容版本；升级失败时保留上一个 runtime 和 current pointer。

## UI/UX

- Settings → Harnesses 显示 `Codex 0.147.0`、安装来源和“需重启生效”。
- 运行中会话显示实际 runtime 版本；本地与远程不一致时显示 warning，而不是静默切换。
- 下载/预取失败显示具体平台、版本和 Retry，不暴露 registry token。

## 风险与兼容

- 0.147.0 stable 优先；不跟随 `0.148.0-alpha.*`。
- 新协议方法通过 capability/版本探测；旧版本缺少方法时隐藏对应 UI。
- 升级必须与 remote node 同步，否则远程功能矩阵按较低版本裁剪。

## 验收

- 三平台安装产物都能启动 `codex app-server` 并完成 initialize。
- 本地和远程节点报告的 runtime version 与 manifest 一致。
- 现有 run/review/compact/steer/permission 测试全部通过。
- 失败升级可恢复到前一个 current pointer。

## 当前验证

- `node_modules/.bin/codex --version` -> `codex-cli 0.147.0`。
- managed 节点 current 已切换到 `~/.superone/harness/codex/versions/0.147.0`，二进制 smoke 返回 `codex-cli 0.147.0`。
- `0.146.1` 版本目录仍保留，可回滚；local remote lab 已用该 managed binary 重启并通过 `/health`。
- 真实生产远程节点/CDN 发布和三平台打包 smoke test 尚未执行。

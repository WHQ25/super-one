# 01. Codex 0.154 Runtime 升级

状态：[PLANNED]

## 目标

把桌面 bundled、CLI/远程节点 managed pin、harness 发布清单统一到 `@openai/codex` `0.154.0`，并以该 **tag** 生成的稳定 + experimental 两套 App Server schema 作为协议审查基线。

不跟 `0.155.0-alpha.*`。不要用过期的本地 `main` 冒充 0.154.0。

## 集成范围

- [`apps/desktop/package.json`](../../../../apps/desktop/package.json) 的 `"@openai/codex": "0.153.2"`。
- [`packages/runtime/src/harness/managed-official.ts`](../../../../packages/runtime/src/harness/managed-official.ts) `OFFICIAL_CODEX_NPM_VERSION`。
- `bun.lock`（`bun install`，不要手改）。
- [`scripts/publish-harness-artifacts.ts`](../../../../scripts/publish-harness-artifacts.ts) 读取 official pin；发布时 desktop / managed / app pin 必须同值。
- `SUPERONE_CODEX_NPM_VERSION` 仍可覆盖，但默认路径必须是 0.154.0。
- CHANGELOG：一次 `chore(codex)` 或随功能提交的 runtime 行。

## 实现步骤

1. 同步改 desktop 依赖和 `OFFICIAL_CODEX_NPM_VERSION`，`bun install`。
2. `node_modules/.bin/codex --version` 必须是 `codex-cli 0.154.0`。
3. 用该二进制各生成一次：
   - 稳定：`codex app-server generate-json-schema`（及 `generate-ts` 如仍可用）
   - 实验：同样命令加 `--experimental`
   输出放到工作目录对照，**不要**把全量生成物提交进 `packages/codex`。稳定 TS 会滤掉 `#[experimental]` 方法；审查必须同时看 Rust `common.rs` / `--experimental` 输出。
4. 对照 `rust-v0.153.2` / `rust-v0.154.0` 的 request、notification、server request，记录增量到 [02](./02-protocol-compat.md)。
5. 本地 managed 安装切到 `~/.superone/harness/codex/versions/0.154.0`；保留 `0.153.2` 目录以便回滚。
6. 远程节点只接受同版本或明确兼容版本；升级失败保留上一个 current pointer。
7. 跑 pin 相关单测：`managed-harness-official.test.ts`、`tarball-installer.test.ts`（它们读 pin 常量，不应硬编码旧版本）。

## UI/UX

- Settings → Harnesses 显示 `Codex 0.154.0`、安装来源和“需重启生效”。
- 运行中会话显示实际 runtime 版本；本地与远程不一致时 warning。
- 下载/预取失败显示平台、版本和 Retry，不暴露 registry token。

## 风险与兼容

- 0.154.0 删除了 `codex mcp-server` 入口（#42993）。SuperOne 走的是 `codex app-server`（[`app-server-connection.ts`](../../../../apps/desktop/src/main/codex/app-server-connection.ts) spawn），升级本身不受影响；文档/脚本里如有残留一并删掉。
- 平台包仍是 `@openai/codex@0.154.0-<platform>-<arch>`。
- 升级必须与 remote node 同步，否则功能矩阵按较低版本裁剪。

## 验收

- 三平台安装产物都能启动 `codex app-server` 并完成 `initialize` + `initialized`。
- 本地和远程报告的 runtime version 与 manifest 一致。
- 现有 run / review / compact / steer / permission 测试通过。
- 失败升级可恢复到 `0.153.2` current pointer。
- 工作目录里同时有稳定与 `--experimental` schema，供 02 使用。

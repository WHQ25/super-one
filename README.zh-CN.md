<p align="center">
  <a href="https://super-one.dev"><img src="docs/logo/text-inline.png" alt="SuperOne" width="420" /></a>
</p>

<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.62.1--alpha-blue?style=flat" alt="Version" /></a>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows%20%7C%20Linux-4493F8?style=flat" alt="支持平台：macOS、Windows、Linux" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BUSL--1.1-orange?style=flat" alt="License: BUSL-1.1" /></a>
</p>

<p align="center">
  <sub><a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a></sub>
</p>

<p align="center">
  <strong>集合所有强大的 harness，扩展它们，并让每一个都拥有 Codex App 级的桌面体验。</strong><br/>
  SuperOne 把 Claude Code、Codex、Cursor、OpenCode、DeepSeek 与 Grok 放进同一个桌面应用，为每一个扩展出浏览器、电脑、手机与彼此，并让它们都拥有第一方应用的打磨程度。
</p>

## 功能

<table>
<tr>
<td width="50%" valign="middle">

### 所有 Harness，一张桌子

Claude Code、Codex、Cursor、OpenCode、DeepSeek 与 Grok 共用同一份项目列表、会话历史、凭据，以及同一批 MCP Server 与 Skill。项目做到一半换 harness 是一个下拉框的事，切换时整个应用会换成该 harness 的品牌色。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/harnesses.png" alt="在同一项目内切换 harness" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 智能体互相雇佣

Claude 会话派生一个 Codex 审查者；Codex 把迁移工作移交给 DeepSeek；Cursor 与一个已经跑了一小时的会话开信箱。`spawn`、`handoff`、`link` 跨 harness 工作，需你批准，交接内容是持久化的 Markdown，可选落在隔离的 git worktree 里。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/collab.png" alt="跨 harness 的会话协作" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 对话旁边一个真实的浏览器

智能体在内嵌 Chromium 中开标签、读无障碍树、点击、输入、录制网络请求、分析页面性能，你随时可以看、随时可以接管。页面通过 WebMCP 发布的工具，在你信任该站点后即可调用。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/browser.png" alt="智能体驱动的内嵌浏览器" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 手机与模拟器

启动 iOS 模拟器或接上 Android 设备。屏幕投到面板里并支持画中画；智能体做快照、点击、输入，你随时可以自己上手滑。控制权由你授予，不会默认拥有。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/devices.png" alt="iOS 模拟器与 Android 设备控制" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Computer use

枚举应用、快照无障碍大纲、放大、点击、输入、等待画面稳定。通过独立签名的 helper 运行，按应用授权，带悬浮停止按钮。目前仅 macOS。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/computer-use.png" alt="智能体操作桌面应用" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 别说，直接画出来

智能体不写一段文字，而是直接在对话里渲染图表、示意图、原型或一个小型交互工具。保存为模板后，它就是一个可以换数据复用的 Widget。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/widgets.png" alt="在对话中渲染的交互式 Widget" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 智能体能调用的小程序

用 Node 宿主加 WebView 写一个 `.s1app`，拖到侧栏，它的工具就出现在每个 harness 里。智能体还能帮你脚手架、打包、注册小程序。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/miniapps.png" alt="安装并被智能体调用的小程序" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### Mosaic 与 Side Chat

多个会话并排平铺，同一仓库的两个 worktree 上跑两个智能体。选中对话中任意文字，旁边打开一个派生的 Side Chat，继承完整上下文与热 prompt cache；关掉后父会话毫无痕迹。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/mosaic.png" alt="Mosaic 布局与 Side Chat" width="100%" />
</td>
</tr>
<tr>
<td width="50%" valign="middle">

### 手机伴侣

会话等你时你会收到通知。用手机通过局域网或可自建的中继直接回复，任何一端回复后通知即撤回。

</td>
<td width="50%">
  <img src="docs/assets/feature-wall/mobile.png" alt="SuperOne 手机应用回复权限请求" width="100%" />
</td>
</tr>
</table>

**还有这些：**

- **Workflow** — 多智能体编排脚本在对话中渲染为实时 DAG。
- **worktree 全流程** — 开启、派生、命名分支、带 diff 预览合回。
- **带 dry-run 的回退** — 回退代码、对话或两者，先看再动。
- **定时发送与自动化** — 消息等过限流窗口再发；cron 自动化。
- **排队 steer** — 在 Claude 和 Codex 上，排队消息可在轮次中途提升为 steer。
- **图片与视频生成** — Google、OpenAI、OpenAI 兼容中转、字节跳动 Ark、NewAPI。
- **跨 harness 的用量与费用** — 一个页面，所有 harness。
- **以及其余** — Plan 审阅、可读的权限提示、todo、subagent、MCP / Skill / Hook / 插件、明暗主题、English 与简体中文。真正的功能清单在 [changelog](CHANGELOG.md)。

---

## 支持的智能体

<p>
  <a href="https://docs.anthropic.com/claude/docs/claude-code"><kbd>Claude Code</kbd></a> &nbsp;
  <a href="https://github.com/openai/codex"><kbd>Codex</kbd></a> &nbsp;
  <a href="https://cursor.com/cli"><kbd>Cursor</kbd></a> &nbsp;
  <a href="https://opencode.ai"><kbd>OpenCode</kbd></a> &nbsp;
  <a href="https://www.deepseek.com"><kbd>DeepSeek</kbd></a> &nbsp;
  <a href="https://x.ai/cli"><kbd>Grok</kbd></a> &nbsp;
  <kbd>+ 更多即将支持</kbd>
</p>

---

## 安装

[macOS Apple Silicon](https://dl.super-one.dev/alpha/latest/SuperOne-arm64.dmg) · [macOS Intel](https://dl.super-one.dev/alpha/latest/SuperOne.dmg) · [Windows (.exe)](https://dl.super-one.dev/alpha/latest/SuperOne%20Setup.exe) · [Linux AppImage](https://dl.super-one.dev/alpha/latest/SuperOne.AppImage)

SuperOne 目前处于 alpha 阶段，会从 `dl.super-one.dev` 自动更新。

---

## 开发

**前置依赖：**[Bun](https://bun.sh) 1.3.9+ 与 Node.js 20+。本仓库是 bun workspaces monorepo，不支持 npm / pnpm。

```bash
git clone https://github.com/WHQ25/super-one.git
cd super-one
bun install            # postinstall 会为 Electron 重建原生模块

bun run dev            # 桌面应用（热重载）
bun run dev:cli        # 无头节点 CLI
bun run dev:web        # 官网，:3000
bun run dev:relay      # 中继 Worker 的 wrangler dev
bun run typecheck      # 全 workspace 类型检查
bun run build:mac      # 或 build:win / build:linux
```

包结构：

- `apps/desktop` — Electron 应用（main / preload / renderer）
- `apps/cli` — 无头节点，以 `@super-one/cli` 发布
- `apps/relay` — 手机端的 Cloudflare Workers 中继，可自建
- `apps/web` — 官网与文档
- `packages/runtime` — desktop 与 CLI 共用的 session / fs / git / spawn-env
- `packages/claude`、`codex`、`cursor`、`deepseek`、`opencode`、`acp` — 每个 harness 一个包
- `packages/shared`、`packages/ui` — 中立类型、harness 能力、i18n、shadcn 基础组件

架构文档见 [`CLAUDE.md`](CLAUDE.md)、[`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) 与 [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md)。它们是写给编码智能体看的，也是本仓库最准确的文档。Commit 规范见 [`AGENTS.md`](AGENTS.md)。

## 许可证

[Business Source License 1.1](LICENSE) — 源码可见。个人、教育及其他非商业目的的生产使用免费；商业目的的生产使用需另行获取许可。每个版本在发布两年后转为 Apache 2.0。

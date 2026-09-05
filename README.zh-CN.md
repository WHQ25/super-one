<div align="center">

<img src="docs/logo/text-inline.png" alt="SuperOne" width="420">

**把所有编码智能体放在同一处 —— 集成、扩展，并让它们彼此协作。**

Claude、Codex、Cursor、OpenCode、DeepSeek 以及任何 ACP 智能体，
共享同一个项目、同一套工具面，以及同一种把工作交给彼此的方式。

[![version](https://img.shields.io/badge/version-0.61.0--alpha-blue)](CHANGELOG.md)
[![platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey)](#安装)
[![license](https://img.shields.io/badge/license-BUSL--1.1-orange)](LICENSE)

[安装](#安装) · [功能](#它能做什么) · [从源码构建](#从源码构建) · [仓库结构](#仓库结构) · [English](README.md)

</div>

---

## SuperOne 是什么？

每个编码智能体都自带一套 CLI、一套配置、一套自己对"会话"的理解 —— 而它们彼此说不上话。
SuperOne 是一个基于 Electron 的桌面应用，从四个方向解决这件事：

**1. 集成。** Claude、Codex、Cursor、OpenCode、DeepSeek 以及任何说 ACP 协议的智能体，
共用同一个项目、同一份会话历史、同一套 provider 与凭据、同一批 MCP Server 与 Skill、
同一套界面。项目做到一半换 harness 是一个下拉框的事，而不是一次迁移。

**2. 扩展。** SuperOne 自带 MCP Server，于是每个 harness 都获得了它自己的 CLI 从未有过的
能力：内嵌浏览器、控制宿主电脑、操作 iOS 模拟器或 Android 设备、生成图片与视频、渲染
交互式 Widget，以及管理 SuperOne 自身的设置。围绕这些的是一个真正的工作区 —— 文件树、
编辑器与预览、终端、Git 状态与 worktree、代码审查面板 —— 在可停靠布局里，而不是文本框
旁边挂一条侧栏。

**3. 协作。** 会话之间可以**跨 harness** 交接工作。一个 Claude 会话可以派生一个 Codex
审查者、把任务移交给 Cursor，或者与一个已经在跑的会话开一条信箱 —— 交接内容是持久化的
Markdown，必要时还能落在独立的 git worktree 里。

**4. 开发你自己的 agentic app。** 小程序（`.s1app`）采用受信任的 Node 宿主负责计算与
智能体工具、WebView 负责渲染的分工。你写的应用，最终会变成智能体可以调用的工具。

> **状态：alpha。** 版本号为 `0.x.y-alpha`，目前只发布了 alpha 通道。内部实现变动频繁。

## 它能做什么

### 复数的编码智能体

| Harness | 对应包 | 说明 |
|---|---|---|
| **Claude** | `@superone/claude` | Plan 模式、subagent、todo、compact、排队 steer、流式工具入参 |
| **Codex** | `@superone/codex` | Plan 模式、compact、排队 steer、ChatGPT / API Key 登录、沙盒预设 |
| **Cursor** | `@superone/cursor` | subagent、todo、流式工具入参 |
| **OpenCode** | `@superone/opencode` | Plan 模式、subagent、todo、compact |
| **DeepSeek** | `@superone/deepseek` | 进程内 harness；todo、subagent、自动压缩上下文 |
| **其他（ACP）** | `@superone/acp` | 任何 Agent Client Protocol 智能体；Grok 与 OpenCode 会被识别品牌 |

各 harness 的能力以数据形式声明在
[`packages/shared/src/harness/harness-capabilities.ts`](packages/shared/src/harness/harness-capabilities.ts)，
所以界面会直接隐藏某个 harness 做不到的功能，而不是让它在运行时失败。
每个 harness 还带有自己的品牌配色 —— 切换 harness，整个应用会跟着换色。

### 智能体真正够得着的工具箱

SuperOne 向所有 harness 暴露内置 MCP Server（`mcp__superone__*`）：

- **浏览器** —— 一个真实的内嵌浏览器，智能体可以导航、点击、输入、滚动、截图、
  录制网络请求、测量性能。它还支持 WebMCP：页面通过 `document.modelContext` 注册的
  工具会在隔离世界中读取，受站点信任闸门控制，并按指纹钉住 —— 页面无法把已批准的
  工具偷换成另一个实现。
- **Computer use** —— 观察并操作宿主桌面，权限浮层保证人始终在环路里。
- **设备** —— 驱动 iOS 模拟器或 Android 设备（真机或 AVD）：截屏、无障碍树、手势合成、
  实时投屏与画中画。
- **媒体** —— 通过可插拔的 provider 生成图片和视频。
- **Widget 与生成式 UI** —— 智能体直接把可交互的 HTML 渲染进对话，而不是用文字描述。
- **小程序（Mini-App）** —— `.s1app` 包，采用类 VS Code 的分工：受信任的 Node 宿主
  负责计算与智能体工具，WebView 负责渲染。把 `.s1app` 拖到侧栏即可安装。
- **会话与配置** —— 检索历史会话、在会话间交接工作，以及读写 SuperOne 的实时设置。

### 会话之间互相交接工作

`session_collab_*` 让一个会话有三种方式把另一个会话拉进来，而且对端可以是**不同的 harness**：

| 模式 | 作用 |
|---|---|
| `spawn` | 派生一个你还会继续对话的子会话 —— 并行扇出，或者一个把结论交回给你的审查者 |
| `handoff` | 创建一个顶层兄弟会话，把任务彻底接管过去 —— 下一阶段、全新上下文、无人值守的后续 |
| `link` | 与一个已经存在的会话开信箱，并唤醒它 |

发起需要你批准；交接的是持久化的 Markdown，而不是抓取来的对话记录；还可以指定单独的
`cwd` 或隔离的 git worktree，避免两个智能体改同一个仓库时打架。

### 不止一台机器

- **远程控制** —— 通过局域网或 Cloudflare Workers 中继
  （[`apps/relay`](apps/relay)，可自建）用手机驱动桌面会话。会话归属是一等公民：
  会话自己知道谁在驱动、谁在旁观。
- **无头节点** —— [`@super-one/cli`](apps/cli) 把一台服务器变成 SuperOne 的执行环境，
  配对之后就像本地一样使用。

### 其余部分

Provider 与 API Key、MCP Server、Skill、Subagent、Hook、插件、定时发送、自动化、
Git worktree、alpha/beta/stable 三通道自动更新、国际化（English / 简体中文）、
明暗主题，以及 macOS 毛玻璃。

各版本的变更见 [`CHANGELOG.md`](CHANGELOG.md)。

## 安装

以下链接始终指向 alpha 通道的最新版本：

| 平台 | 下载 |
|---|---|
| macOS（Apple Silicon） | [SuperOne-arm64.dmg](https://dl.super-one.dev/alpha/latest/SuperOne-arm64.dmg) |
| macOS（Intel） | [SuperOne.dmg](https://dl.super-one.dev/alpha/latest/SuperOne.dmg) |
| Windows | [SuperOne Setup.exe](https://dl.super-one.dev/alpha/latest/SuperOne%20Setup.exe) |
| Linux | [SuperOne.AppImage](https://dl.super-one.dev/alpha/latest/SuperOne.AppImage) |

应用会从 `dl.super-one.dev` 自动更新。更新通道可在 **设置 → 通用** 中切换；
通道是级联的 —— alpha 用户同样会收到 beta 和 stable 线上的构建。

无头节点：

```bash
npm install -g @super-one/cli@alpha
superone start
```

## 从源码构建

**前置依赖：**[Bun](https://bun.sh) 1.3.9+（本仓库是 bun workspaces monorepo，
不支持 npm/pnpm）与 Node.js 20+。

```bash
git clone https://github.com/WHQ25/super-one.git
cd super-one
bun install          # postinstall 会为 Electron 重建原生模块

bun run dev          # 启动桌面应用（热重载）
bun run typecheck    # 全 workspace 类型检查
bun run test         # 桌面测试套件
```

打包：

```bash
bun run build:mac    # macOS DMG + ZIP
bun run build:win    # Windows NSIS 安装包
bun run build:linux  # Linux AppImage
```

其他入口：

```bash
bun run dev:web      # Next.js 站点，:3000
bun run dev:cli      # 无头节点 CLI
bun run dev:cli:lab  # 本地远程节点实验室，:7789（桌面端可配对连上）
bun run dev:relay    # 中继 Worker 的 wrangler dev
bun run storybook    # 组件工作台（packages/ui + desktop）
```

> 桌面测试套件约 650 个文件，跑一次要几分钟。日常开发请缩小范围：
> 在 `apps/desktop` 下执行 `bunx vitest run --changed HEAD`。

## 仓库结构

```
super-one/
├── apps/
│   ├── desktop/   @superone/desktop  — Electron 应用（main / preload / renderer）
│   ├── cli/       @superone/cli      — 无头节点，以 @super-one/cli 发布
│   ├── web/       @superone/web      — Next.js 官网 / 文档 / demo
│   ├── relay/     @superone/relay    — Cloudflare Workers + Durable Objects 中继
│   └── video/     @superone/video    — Remotion 合成与离线渲染
└── packages/
    ├── shared/          中立类型、harness 品牌、i18n、小程序运行时
    ├── ui/              shadcn 基础组件 + OKLch 主题，desktop 与 web 共用
    ├── runtime/         session / fs / git / lease / spawn-env / crypto
    ├── claude, codex, cursor, deepseek, opencode, acp/   harness 包（按需依赖）
    ├── desktop-mocks/   Storybook 与测试用的 fixture
    ├── video-compositions/
    └── tsconfig/        共享基础配置
```

跨包引用一律走包名（`@superone/shared/agent-types`、`@superone/ui/components/ui/button`），
由各包的 `exports` 映射解析 —— 包之间没有构建步骤，Vite 和 TypeScript 直接读源码。

## 文档

| 位置 | 内容 |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Monorepo 布局、跨包解析、仓库级约定 |
| [`apps/desktop/CLAUDE.md`](apps/desktop/CLAUDE.md) | Electron 架构、IPC、Store、远程控制、小程序、测试、发布 |
| [`apps/cli/CLAUDE.md`](apps/cli/CLAUDE.md) | 无头节点 RPC、工作区、配对、本地实验室 |
| [`AGENTS.md`](AGENTS.md) | Commit message 规范（人同样适用） |
| [`docs/design/`](docs/design) | harness、远程节点、权限模型的设计文档 |
| 应用内 | `read_manual` —— 智能体可读的产品 / 小程序 / 媒体 / Widget 手册 |

`CLAUDE.md` 系列是写给编码智能体看的，但它们也是本仓库最准确的架构文档。请读它们。

## 参与开发

Commit 遵循 `<type>(<scope>): <subject>` —— 祈使句、小写开头、**英文**、不超过 72 字符、
一次提交只做一件事。完整规范（包括何时需要正文、正文该写什么）见 [`AGENTS.md`](AGENTS.md)。

提 PR 前请跑：`bun run typecheck`，以及在 `apps/desktop` 下的
`bunx vitest run --changed HEAD`。

## 许可证

[Business Source License 1.1](LICENSE) —— 源码可见（source-available），但不是 OSI 意义上的开源。

你可以复制、修改、再分发本作品，并出于个人、教育或其他非商业目的在生产环境中使用。
以商业为目的的生产使用需要向许可方另行获取商业许可。每个版本在发布两年后转为
Apache 2.0 许可。

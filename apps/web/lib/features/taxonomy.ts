import type { HarnessId } from "@superone/shared/agent-types"
import type { Locale } from "@/i18n/routing"

export type FeatureVideoId =
  | "F01"
  | "F02"
  | "F03"
  | "F04"
  | "F05"
  | "F06"
  | "F07"
  | "F08"
  | "F09"
  | "F10"

/**
 * Display order for harness filters and badges. The taxonomy owns the order so
 * a filter row reads the same everywhere, independent of object key order.
 */
export const HARNESS_ORDER: HarnessId[] = [
  "claude",
  "codex",
  "cursor",
  "opencode",
  "dsh",
  "acp",
]

export type SubFeature = {
  slug: string
  feature: string
  category: string
  /** Harnesses that expose this. Omitted means it is harness-agnostic. */
  harnesses?: HarnessId[]
  videoId?: FeatureVideoId
  title: Record<Locale, string>
  blurb: Record<Locale, string>
}

export type Feature = {
  slug: string
  category: string
  /** Harnesses that expose this. Omitted means it is harness-agnostic. */
  harnesses?: HarnessId[]
  videoId?: FeatureVideoId
  title: Record<Locale, string>
  blurb: Record<Locale, string>
  subFeatures: SubFeature[]
}

export type FeatureCategory = {
  slug: string
  title: Record<Locale, string>
  blurb: Record<Locale, string>
  harnessTabs: boolean
  features: Feature[]
}

export const featureTaxonomy: FeatureCategory[] = [
  {
    slug: "workspace",
    title: { en: "Workspace", zh: "工作区" },
    blurb: {
      en: "Open projects, run parallel sessions, branch into worktrees, browse files.",
      zh: "打开项目、并行多会话、切到独立 worktree、浏览文件。",
    },
    harnessTabs: false,
    features: [
      {
        slug: "projects",
        category: "workspace",
        videoId: "F06",
        title: { en: "Projects & sessions", zh: "项目与会话" },
        blurb: {
          en: "Open projects and juggle parallel agent sessions on each.",
          zh: "打开项目,在每个项目上并行多个 agent 会话。",
        },
        subFeatures: [
          {
            slug: "project-management",
            feature: "projects",
            category: "workspace",
            title: { en: "Project management", zh: "项目管理" },
            blurb: {
              en: "Open, switch, and pin recent projects from the sidebar.",
              zh: "在侧栏打开、切换、收藏最近项目。",
            },
          },
          {
            slug: "parallel-sessions",
            feature: "projects",
            category: "workspace",
            videoId: "F06",
            title: { en: "Parallel sessions", zh: "并行会话" },
            blurb: {
              en: "Multiple agent sessions on the same project, with background suspend & resume.",
              zh: "同项目多会话并行,切走自动挂起、回来恢复。",
            },
          },
          {
            slug: "session-history",
            feature: "projects",
            category: "workspace",
            title: { en: "Session history & AI rename", zh: "会话历史与 AI 命名" },
            blurb: {
              en: "Resume any past session; titles auto-generated from the conversation.",
              zh: "任意历史会话一键 resume,标题由对话自动推断。",
            },
          },
          {
            slug: "session-fork",
            feature: "projects",
            category: "workspace",
            title: { en: "Session fork", zh: "会话分叉" },
            blurb: {
              en: "Fork any session at any past message into a fresh local copy.",
              zh: "从任意历史消息分叉出一份新的本地会话。",
            },
          },
        ],
      },
      {
        slug: "worktrees",
        category: "workspace",
        videoId: "F08",
        title: { en: "Git worktrees", zh: "Git Worktree" },
        blurb: {
          en: "Isolate a session on its own branch and directory, one click away.",
          zh: "一键把会话隔离到独立分支与目录。",
        },
        subFeatures: [
          {
            slug: "move-to-worktree",
            feature: "worktrees",
            category: "workspace",
            videoId: "F08",
            title: { en: "Move session to worktree", zh: "会话搬入 worktree" },
            blurb: {
              en: "One click moves a session into a dedicated worktree, uncommitted changes ported over.",
              zh: "一键把会话搬到独立 worktree,未提交改动一起带过去。",
            },
          },
          {
            slug: "fork-to-worktree",
            feature: "worktrees",
            category: "workspace",
            title: { en: "Fork into a fresh worktree", zh: "分叉到新 worktree" },
            blurb: {
              en: "Fork a session at any past message straight into a new worktree.",
              zh: "从任意历史消息分叉,直接落到一个新 worktree。",
            },
          },
        ],
      },
      {
        slug: "files",
        category: "workspace",
        title: { en: "Files & terminal", zh: "文件与终端" },
        blurb: {
          en: "File tree, fuzzy search, inline preview, and an integrated terminal.",
          zh: "文件树、模糊搜索、内联预览、集成终端。",
        },
        subFeatures: [
          {
            slug: "file-tree",
            feature: "files",
            category: "workspace",
            title: { en: "Project file tree", zh: "项目文件树" },
            blurb: {
              en: "Sidebar tree with git status indicators.",
              zh: "侧栏文件树,带 git 状态标记。",
            },
          },
          {
            slug: "fuzzy-search",
            feature: "files",
            category: "workspace",
            title: { en: "Fuzzy file search", zh: "模糊文件搜索" },
            blurb: {
              en: "⌘P opens ranked fuzzy matching grouped by directory.",
              zh: "⌘P 按目录分组的排序模糊搜索。",
            },
          },
          {
            slug: "file-preview",
            feature: "files",
            category: "workspace",
            title: { en: "File preview", zh: "文件预览" },
            blurb: {
              en: "Inline preview for code, images, text, and markdown.",
              zh: "代码、图片、文本、Markdown 内联预览。",
            },
          },
          {
            slug: "integrated-terminal",
            feature: "files",
            category: "workspace",
            title: { en: "Integrated terminal", zh: "集成终端" },
            blurb: {
              en: "Run commands without leaving the project.",
              zh: "无需离开项目即可跑命令。",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "conversation",
    title: { en: "Conversation", zh: "对话" },
    blurb: {
      en: "What you type and what you read — the rich-text composer, message rendering, audit trail.",
      zh: "你敲什么、看什么 —— 富文本输入框、消息渲染、审计面板。",
    },
    harnessTabs: false,
    features: [
      {
        slug: "composer",
        category: "conversation",
        videoId: "F10",
        title: { en: "Composer", zh: "输入框" },
        blurb: {
          en: "A rich-text input built for agents: slash commands, mentions, files.",
          zh: "为 agent 打造的富文本输入框:斜杠命令、提及、文件。",
        },
        subFeatures: [
          {
            slug: "rich-text-editor",
            feature: "composer",
            category: "conversation",
            videoId: "F10",
            title: { en: "Tiptap rich-text editor", zh: "Tiptap 富文本编辑器" },
            blurb: {
              en: "IME-safe Enter, drag-drop files, paste images, code-aware formatting.",
              zh: "IME 安全回车、拖放文件、粘贴图片、代码感知格式化。",
            },
          },
          {
            slug: "slash-menu",
            feature: "composer",
            category: "conversation",
            title: { en: "Slash menu", zh: "斜杠菜单" },
            blurb: {
              en: "Type / for fuzzy-searched commands and skills.",
              zh: "敲 / 模糊搜索命令与 skills。",
            },
          },
          {
            slug: "mentions",
            feature: "composer",
            category: "conversation",
            title: { en: "@ mentions", zh: "@ 提及" },
            blurb: {
              en: "Mention files, sessions, and artifacts inline.",
              zh: "在输入框里 @ 文件、会话、工件。",
            },
          },
        ],
      },
      {
        slug: "replies",
        category: "conversation",
        title: { en: "Replies & transparency", zh: "回复与透明度" },
        blurb: {
          en: "Rendered messages, collapsible reasoning, and a replayable audit trail.",
          zh: "渲染后的消息、可折叠思考、可回放的审计记录。",
        },
        subFeatures: [
          {
            slug: "markdown-rendering",
            feature: "replies",
            category: "conversation",
            title: { en: "Markdown rendering", zh: "Markdown 渲染" },
            blurb: {
              en: "Streamdown-based rendering: code fences, lists, links, math.",
              zh: "Streamdown 渲染:代码块、列表、链接、数学公式。",
            },
          },
          {
            slug: "thinking-blocks",
            feature: "replies",
            category: "conversation",
            title: { en: "Thinking blocks", zh: "Thinking 块" },
            blurb: {
              en: "Collapsible blocks reveal the agent's reasoning when you want it.",
              zh: "可折叠的思考块,想看就展开。",
            },
          },
          {
            slug: "file-chip",
            feature: "replies",
            category: "conversation",
            title: { en: "File chips", zh: "File chip" },
            blurb: {
              en: "Referenced files appear as chips you can click to open.",
              zh: "聊天里引用的文件以 chip 形式出现,点开即查看。",
            },
          },
          {
            slug: "activity-panel",
            feature: "replies",
            category: "conversation",
            title: { en: "Activity & audit trail", zh: "活动面板与审计记录" },
            blurb: {
              en: "Every tool call, every approval, timestamped and replayable.",
              zh: "每次工具调用、每次审批,带时间戳可回放。",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "engines",
    title: { en: "Agent engines", zh: "Agent 引擎" },
    blurb: {
      en: "Six agent engines in one app — switch per session, and use each engine's native powers.",
      zh: "一个应用里六套 agent 引擎 —— 按会话切换,各用各的原生能力。",
    },
    harnessTabs: true,
    features: [
      {
        slug: "dual-harness",
        category: "engines",
        videoId: "F01",
        title: { en: "Multi-harness switching", zh: "多引擎切换" },
        blurb: {
          en: "Pick any harness per session and switch any time.",
          zh: "每个会话独立选择 harness,随时切换。",
        },
        subFeatures: [
          {
            slug: "per-session-engine",
            feature: "dual-harness",
            category: "engines",
            videoId: "F01",
            title: { en: "Engine per session", zh: "每会话独立引擎" },
            blurb: {
              en: "Each session independently runs on its own harness.",
              zh: "每个会话独立跑在自己的 harness 上。",
            },
          },
          {
            slug: "switch-anytime",
            feature: "dual-harness",
            category: "engines",
            title: { en: "Switch any time", zh: "随时切换" },
            blurb: {
              en: "Swap engines mid-project without leaving the app.",
              zh: "项目进行中也能换引擎,不用切应用。",
            },
          },
        ],
      },
      {
        slug: "claude-core",
        category: "engines",
        harnesses: ["claude"],
        videoId: "F09",
        title: { en: "Claude essentials", zh: "Claude 核心" },
        blurb: {
          en: "Permissions, planning, thinking budget, models, and slash commands.",
          zh: "权限、计划、thinking 预算、模型、斜杠命令。",
        },
        subFeatures: [
          {
            slug: "permission-modes",
            feature: "claude-core",
            category: "engines",
            harnesses: ["claude"],
            videoId: "F09",
            title: { en: "Permission modes", zh: "Permission modes" },
            blurb: {
              en: "Four modes: default, acceptEdits, plan, bypassPermissions.",
              zh: "四档模式:default、acceptEdits、plan、bypassPermissions。",
            },
          },
          {
            slug: "plan-mode",
            feature: "claude-core",
            category: "engines",
            harnesses: ["claude"],
            videoId: "F05",
            title: { en: "Plan mode", zh: "Plan mode" },
            blurb: {
              en: "Approvable plans before any code change.",
              zh: "改代码前先拿可审批的计划。",
            },
          },
          {
            slug: "effort-thinking",
            feature: "claude-core",
            category: "engines",
            harnesses: ["claude"],
            title: { en: "Effort & thinking", zh: "Effort 与 thinking" },
            blurb: {
              en: "Tune Claude's thinking budget per session.",
              zh: "按会话调 Claude 的 thinking 预算。",
            },
          },
          {
            slug: "models",
            feature: "claude-core",
            category: "engines",
            harnesses: ["claude"],
            title: { en: "Model selection", zh: "模型选择" },
            blurb: {
              en: "Opus, Sonnet, Haiku — pick per session.",
              zh: "Opus、Sonnet、Haiku —— 按会话选。",
            },
          },
          {
            slug: "slash-commands",
            feature: "claude-core",
            category: "engines",
            harnesses: ["claude"],
            title: { en: "Slash commands", zh: "斜杠命令" },
            blurb: {
              en: "Built-in /commands plus anything from your installed skills.",
              zh: "内置 /命令,加上所有已安装 skill 提供的命令。",
            },
          },
        ],
      },
      {
        slug: "claude-orchestration",
        category: "engines",
        harnesses: ["claude"],
        videoId: "F07",
        title: { en: "Claude orchestration", zh: "Claude 编排" },
        blurb: {
          en: "Delegate to subagents, track tasks, and field structured questions.",
          zh: "委派子代理、跟踪任务、回应结构化追问。",
        },
        subFeatures: [
          {
            slug: "subagents",
            feature: "claude-orchestration",
            category: "engines",
            harnesses: ["claude"],
            videoId: "F07",
            title: { en: "Subagents orchestration", zh: "子代理调度" },
            blurb: {
              en: "Delegate work to specialist subagents in foreground or background.",
              zh: "把活分给专才子代理,前台或后台跑。",
            },
          },
          {
            slug: "todos-tasks",
            feature: "claude-orchestration",
            category: "engines",
            harnesses: ["claude"],
            title: { en: "TodoWrite & TaskCreate", zh: "TodoWrite 与 TaskCreate" },
            blurb: {
              en: "Built-in task tracking the agent updates as it works.",
              zh: "内置任务管理,智能体边干边更新。",
            },
          },
          {
            slug: "ask-user",
            feature: "claude-orchestration",
            category: "engines",
            harnesses: ["claude"],
            title: { en: "AskUserQuestion", zh: "AskUserQuestion" },
            blurb: {
              en: "The agent asks structured follow-ups when it needs your input.",
              zh: "智能体需要你确认时,会发结构化追问。",
            },
          },
        ],
      },
      {
        slug: "codex-core",
        category: "engines",
        harnesses: ["codex"],
        title: { en: "Codex essentials", zh: "Codex 核心" },
        blurb: {
          en: "Sandbox presets, the native action loop, and model selection.",
          zh: "沙箱预设、原生动作循环、模型选择。",
        },
        subFeatures: [
          {
            slug: "permission-sandbox",
            feature: "codex-core",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Permission presets & sandbox", zh: "权限预设与沙箱" },
            blurb: {
              en: "Default sandboxed or full-access — your call per session.",
              zh: "默认沙箱或 full-access —— 按会话选。",
            },
          },
          {
            slug: "codex-actions",
            feature: "codex-core",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Five Codex actions", zh: "Codex 五动作" },
            blurb: {
              en: "run, review, compact, steer, interrupt — Codex's native loop.",
              zh: "run、review、compact、steer、interrupt —— Codex 原生工作循环。",
            },
          },
          {
            slug: "codex-models",
            feature: "codex-core",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Model selection", zh: "模型选择" },
            blurb: {
              en: "GPT-5 and GPT-5.5 over the Responses API.",
              zh: "GPT-5 与 GPT-5.5,走 Responses API。",
            },
          },
        ],
      },
      {
        slug: "codex-advanced",
        category: "engines",
        harnesses: ["codex"],
        title: { en: "Codex advanced", zh: "Codex 进阶" },
        blurb: {
          en: "Capabilities only Codex has today — computer use, image generation, thread surgery.",
          zh: "目前只有 Codex 独占的能力 —— computer use、图像生成、thread 操作。",
        },
        subFeatures: [
          {
            slug: "computer-use",
            feature: "codex-advanced",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Computer use", zh: "Computer use(计算机操作)" },
            blurb: {
              en: "Codex can read your screen and drive the OS to complete tasks.",
              zh: "Codex 可以读屏 + 操作系统帮你完成任务。",
            },
          },
          {
            slug: "image-generation",
            feature: "codex-advanced",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Image generation", zh: "图像生成" },
            blurb: {
              en: "Generate images mid-conversation without leaving the session.",
              zh: "对话中途直接生图,不用切应用。",
            },
          },
          {
            slug: "fork-rollback",
            feature: "codex-advanced",
            category: "engines",
            harnesses: ["codex"],
            title: { en: "Thread fork & rollback", zh: "Thread fork 与 rollback" },
            blurb: {
              en: "Fork a thread or roll back N turns — Codex-native protocol.",
              zh: "Fork 一份 thread 或 rollback N 轮 —— Codex 原生协议。",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "extend",
    title: { en: "Extend & build", zh: "扩展与构建" },
    blurb: {
      en: "Wire resources into the engine's brain, render inline widgets, build sandboxed mini-apps.",
      zh: "把资源接入引擎大脑、渲染内联 widget、构建沙盒小程序。",
    },
    harnessTabs: false,
    features: [
      {
        slug: "resources",
        category: "extend",
        title: { en: "Agent resources", zh: "智能体资源" },
        blurb: {
          en: "MCP servers, skills, subagents, plugins, hooks, and project memory.",
          zh: "MCP、Skills、子代理、Plugin、Hooks、项目记忆。",
        },
        subFeatures: [
          {
            slug: "mcp-servers",
            feature: "resources",
            category: "extend",
            title: { en: "MCP servers", zh: "MCP 服务器" },
            blurb: {
              en: "Add tools, data, and integrations via the Model Context Protocol.",
              zh: "通过 MCP 协议接入工具、数据、第三方集成。",
            },
          },
          {
            slug: "skills",
            feature: "resources",
            category: "extend",
            harnesses: ["claude"],
            title: { en: "Skills", zh: "Skills" },
            blurb: {
              en: "Pre-baked agent workflows triggered by /skill-name.",
              zh: "预置 agent 工作流,/skill-name 即触发。",
            },
          },
          {
            slug: "subagents-library",
            feature: "resources",
            category: "extend",
            harnesses: ["claude"],
            title: { en: "Subagents library", zh: "子代理库" },
            blurb: {
              en: "Define specialist subagents with their own prompts, tools, and models.",
              zh: "定义有自己 prompt、工具、模型的专才子代理。",
            },
          },
          {
            slug: "plugins",
            feature: "resources",
            category: "extend",
            harnesses: ["claude"],
            title: { en: "Plugins & marketplace", zh: "Plugin 与市场" },
            blurb: {
              en: "Install plugins from the marketplace or build your own.",
              zh: "从市场安装 plugin,或自己写一个。",
            },
          },
          {
            slug: "hooks",
            feature: "resources",
            category: "extend",
            harnesses: ["claude"],
            title: { en: "Hooks", zh: "Hooks" },
            blurb: {
              en: "SessionStart, PreToolUse, Stop, and more — react to agent lifecycle events.",
              zh: "SessionStart、PreToolUse、Stop 等 —— 对智能体生命周期事件做响应。",
            },
          },
          {
            slug: "memory-instructions",
            feature: "resources",
            category: "extend",
            title: { en: "Memory & project instructions", zh: "Memory 与项目说明" },
            blurb: {
              en: "Claude reads CLAUDE.md, Codex reads AGENTS.md — your project's brain on disk.",
              zh: "Claude 读 CLAUDE.md,Codex 读 AGENTS.md —— 项目大脑的磁盘版本。",
            },
          },
        ],
      },
      {
        slug: "widgets",
        category: "extend",
        title: { en: "Inline widgets", zh: "内联 Widget" },
        blurb: {
          en: "An MCP tool that lets the agent render interactive HTML/SVG widgets inline in chat.",
          zh: "一个 MCP 工具,让智能体在聊天里直接渲染 HTML/SVG 可交互组件。",
        },
        subFeatures: [
          {
            slug: "widget-show",
            feature: "widgets",
            category: "extend",
            title: { en: "widget_show MCP tool", zh: "widget_show MCP 工具" },
            blurb: {
              en: "Agents call widget_show to render SVG diagrams or HTML widgets inline.",
              zh: "智能体调用 widget_show,在聊天里渲染 SVG 图或 HTML 组件。",
            },
          },
          {
            slug: "widget-modules",
            feature: "widgets",
            category: "extend",
            title: { en: "Five widget modules", zh: "五大 widget 模块" },
            blurb: {
              en: "Built-in guides for diagrams, UI mockups, interactive explainers, charts, art.",
              zh: "内置 5 类指南:diagram、mockup、interactive、chart、art。",
            },
          },
        ],
      },
      {
        slug: "mini-apps",
        category: "extend",
        videoId: "F02",
        title: { en: "Mini-apps", zh: "小程序" },
        blurb: {
          en: "The agent builds sandboxed apps you can save, reuse, and share — SuperOne's extensibility core.",
          zh: "智能体构建可保存、复用、分享的沙盒小程序 —— SuperOne 可扩展性的核心。",
        },
        subFeatures: [
          {
            slug: "miniapp-platform",
            feature: "mini-apps",
            category: "extend",
            videoId: "F02",
            title: { en: "Mini-app sandbox platform", zh: "小程序沙盒平台" },
            blurb: {
              en: "iframe + webview dual runtime, full UI APIs, MCP-driven.",
              zh: "iframe + webview 双 runtime,完整 UI API,由 MCP 驱动。",
            },
          },
          {
            slug: "miniapp-install",
            feature: "mini-apps",
            category: "extend",
            title: { en: ".s1app packaging & install", zh: ".s1app 打包与安装" },
            blurb: {
              en: "Zip + SHA-256 integrity check; drag-and-drop to install.",
              zh: "Zip + SHA-256 完整性校验;拖拽即装。",
            },
          },
          {
            slug: "miniapp-overlay-api",
            feature: "mini-apps",
            category: "extend",
            title: { en: "Overlay API", zh: "Overlay API" },
            blurb: {
              en: "Sandboxed apps get host-rendered toast, popover, and context menus.",
              zh: "沙盒小程序可调用宿主提供的 toast、popover、右键菜单。",
            },
          },
          {
            slug: "miniapp-dev",
            feature: "mini-apps",
            category: "extend",
            title: { en: "Mini-app dev workflow", zh: "小程序开发工作流" },
            blurb: {
              en: "Embedded build/dev system: setup, register, pack, update types.",
              zh: "应用内嵌开发流程:setup / register / pack / update_types。",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "connect",
    title: { en: "Remote & connect", zh: "远程与接入" },
    blurb: {
      en: "Drive sessions from your phone, schedule background work, and wire up model providers.",
      zh: "用手机驱动会话、调度后台任务、接入模型 provider。",
    },
    harnessTabs: false,
    features: [
      {
        slug: "remote",
        category: "connect",
        videoId: "F03",
        title: { en: "Mobile remote", zh: "手机远程" },
        blurb: {
          en: "Drive a desktop session from your phone over an end-to-end encrypted channel.",
          zh: "用手机驱动桌面会话,走端到端加密通道。",
        },
        subFeatures: [
          {
            slug: "mobile-remote",
            feature: "remote",
            category: "connect",
            videoId: "F03",
            title: { en: "Mobile remote control", zh: "手机远程控制" },
            blurb: {
              en: "Resume sessions, approve tools, get pinged from your phone.",
              zh: "在手机上续会话、批工具、收推送。",
            },
          },
          {
            slug: "multi-mobile",
            feature: "remote",
            category: "connect",
            title: { en: "Multi-mobile per desktop", zh: "一台桌面对多手机" },
            blurb: {
              en: "Several phones can watch the same desktop session concurrently.",
              zh: "多台手机可以同时看同一台桌面会话。",
            },
          },
          {
            slug: "e2e-encryption",
            feature: "remote",
            category: "connect",
            title: { en: "End-to-end encryption", zh: "端到端加密" },
            blurb: {
              en: "Relay never sees your session contents in plaintext.",
              zh: "Relay 看不到明文的会话内容。",
            },
          },
          {
            slug: "self-hosted-relay",
            feature: "remote",
            category: "connect",
            title: { en: "Self-hosted Cloudflare relay", zh: "自托管 Cloudflare relay" },
            blurb: {
              en: "Bring your own Cloudflare account and run the relay on Workers + Durable Objects.",
              zh: "用你自己的 Cloudflare 账号,在 Workers + Durable Object 上跑 relay。",
            },
          },
        ],
      },
      {
        slug: "automation",
        category: "connect",
        title: { en: "Automation", zh: "自动化" },
        blurb: {
          en: "Scheduled agents, background tasks, and SuperOne-native notifications.",
          zh: "定时 agent、后台任务、SuperOne 原生通知。",
        },
        subFeatures: [
          {
            slug: "scheduled-agents",
            feature: "automation",
            category: "connect",
            title: { en: "Scheduled agents", zh: "定时 agent" },
            blurb: {
              en: "Cron-style schedules that fire an agent prompt automatically.",
              zh: "Cron 风格的计划任务,定时触发 agent 指令。",
            },
          },
          {
            slug: "background-tasks",
            feature: "automation",
            category: "connect",
            title: { en: "Background tasks & notifications", zh: "后台任务与通知" },
            blurb: {
              en: "Long-running tasks notify you when they're done, even on the road.",
              zh: "长任务跑完通知你,在路上也能收到。",
            },
          },
        ],
      },
      {
        slug: "providers",
        category: "connect",
        title: { en: "Model providers", zh: "模型 Provider" },
        blurb: {
          en: "API keys, OAuth logins, and custom gateways for each engine.",
          zh: "API key、OAuth、自定义网关,每个引擎各自配。",
        },
        subFeatures: [
          {
            slug: "claude-providers",
            feature: "providers",
            category: "connect",
            harnesses: ["claude"],
            title: { en: "Claude API & OAuth", zh: "Claude API 与 OAuth" },
            blurb: {
              en: "Use your Anthropic API key or sign in via OAuth.",
              zh: "用 Anthropic API key,或通过 OAuth 登录。",
            },
          },
          {
            slug: "claude-custom-gateway",
            feature: "providers",
            category: "connect",
            harnesses: ["claude"],
            title: { en: "Custom Claude gateway", zh: "自定义 Claude 网关" },
            blurb: {
              en: "Point Claude at a self-hosted or third-party compatible gateway.",
              zh: "把 Claude 指向自托管或第三方兼容网关。",
            },
          },
          {
            slug: "codex-auth",
            feature: "providers",
            category: "connect",
            harnesses: ["codex"],
            title: { en: "Codex auth modes", zh: "Codex 认证方式" },
            blurb: {
              en: "Auto, ChatGPT login, or API key — switch any time.",
              zh: "Auto、ChatGPT 登录、API key —— 随时切。",
            },
          },
          {
            slug: "codex-custom-providers",
            feature: "providers",
            category: "connect",
            harnesses: ["codex"],
            title: { en: "Custom model_providers", zh: "自定义 model_providers" },
            blurb: {
              en: "Wire Codex to any Responses-API-compatible provider via config.",
              zh: "通过配置把 Codex 接到任意 Responses API 兼容 provider。",
            },
          },
        ],
      },
    ],
  },
  {
    slug: "personalize",
    title: { en: "Personalize", zh: "个性化" },
    blurb: {
      en: "Make the workspace yours — brand hue, dark mode, window style, update channels.",
      zh: "把工作区变成你的:品牌色、暗色模式、窗口风格、更新通道。",
    },
    harnessTabs: false,
    features: [
      {
        slug: "theme",
        category: "personalize",
        videoId: "F04",
        title: { en: "Theme & brand", zh: "主题与品牌色" },
        blurb: {
          en: "Retint the whole app per engine; follow the system light/dark.",
          zh: "按引擎给整个应用换色;明暗跟随系统。",
        },
        subFeatures: [
          {
            slug: "brand-hue",
            feature: "theme",
            category: "personalize",
            videoId: "F04",
            title: { en: "Brand hue per engine", zh: "每引擎独立品牌色" },
            blurb: {
              en: "OKLch slider retints the whole app — different hue per engine.",
              zh: "OKLch 滑条一键换色,每个引擎可独立配色。",
            },
          },
          {
            slug: "dark-mode",
            feature: "theme",
            category: "personalize",
            title: { en: "Light, dark & system", zh: "明亮、暗色与跟随系统" },
            blurb: {
              en: "Theme follows OS by default; override any time.",
              zh: "默认跟随系统,随时手动覆盖。",
            },
          },
        ],
      },
      {
        slug: "window",
        category: "personalize",
        title: { en: "Window & updates", zh: "窗口与更新" },
        blurb: {
          en: "Window chrome, multi-window layouts, and auto-update channels.",
          zh: "窗口外观、多窗口布局、自动更新通道。",
        },
        subFeatures: [
          {
            slug: "window-style",
            feature: "window",
            category: "personalize",
            title: { en: "Window style & multi-window", zh: "窗口风格与多窗口" },
            blurb: {
              en: "macOS hiddenInset titlebar, multi-window layouts, mini window mode.",
              zh: "macOS hiddenInset 标题栏、多窗口布局、Mini window 模式。",
            },
          },
          {
            slug: "auto-update",
            feature: "window",
            category: "personalize",
            title: { en: "Auto-update channels", zh: "自动更新通道" },
            blurb: {
              en: "Alpha, beta, and stable channels via Cloudflare R2.",
              zh: "Alpha、beta、stable 三档通道,通过 Cloudflare R2 分发。",
            },
          },
        ],
      },
    ],
  },
]

export function getCategory(slug: string): FeatureCategory | undefined {
  return featureTaxonomy.find((c) => c.slug === slug)
}

export function getFeature(
  category: string,
  feature: string,
): Feature | undefined {
  return getCategory(category)?.features.find((f) => f.slug === feature)
}

export function getSubFeature(
  category: string,
  feature: string,
  sub: string,
): SubFeature | undefined {
  return getFeature(category, feature)?.subFeatures.find((s) => s.slug === sub)
}

export function allCategoryParams(): { category: string }[] {
  return featureTaxonomy.map((c) => ({ category: c.slug }))
}

export function allFeatureParams(): { category: string; feature: string }[] {
  return featureTaxonomy.flatMap((c) =>
    c.features.map((f) => ({ category: c.slug, feature: f.slug })),
  )
}

export function allSubFeatureParams(): {
  category: string
  feature: string
  sub: string
}[] {
  return featureTaxonomy.flatMap((c) =>
    c.features.flatMap((f) =>
      f.subFeatures.map((s) => ({
        category: c.slug,
        feature: f.slug,
        sub: s.slug,
      })),
    ),
  )
}

const flatSubFeatures: SubFeature[] = featureTaxonomy.flatMap((c) =>
  c.features.flatMap((f) => f.subFeatures),
)

export function neighborSubFeatures(
  category: string,
  feature: string,
  sub: string,
): { prev?: SubFeature; next?: SubFeature } {
  const idx = flatSubFeatures.findIndex(
    (s) => s.category === category && s.feature === feature && s.slug === sub,
  )
  if (idx < 0) return {}
  return { prev: flatSubFeatures[idx - 1], next: flatSubFeatures[idx + 1] }
}

export function featuresForHarness(
  cat: FeatureCategory,
  filter: HarnessId | "all",
): Feature[] {
  if (filter === "all" || !cat.harnessTabs) return cat.features
  // A feature with no harnesses listed is agnostic, so it survives every filter.
  return cat.features.filter((f) => !f.harnesses || f.harnesses.includes(filter))
}

/** Harnesses a category actually has content for, in display order. */
export function harnessesInCategory(cat: FeatureCategory): HarnessId[] {
  const present = new Set<HarnessId>()
  for (const f of cat.features) for (const h of f.harnesses ?? []) present.add(h)
  return HARNESS_ORDER.filter((h) => present.has(h))
}

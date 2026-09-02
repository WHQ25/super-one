import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-25",
  category: "feature",
  version: "0.47.2-alpha",
  title: {
    en: "OpenCode joins as a fourth engine",
    zh: "OpenCode 作为第四套引擎加入",
  },
  summary: {
    en: "OpenCode runs as a full session harness — native commands, agent selection, compact, rewind and fork, MCP with OAuth, shell mode and session sharing — and folds into the same model selector as everyone else.",
    zh: "OpenCode 作为完整的会话 harness 运行 —— 原生命令、agent 选择、compact、rewind 与 fork、带 OAuth 的 MCP、shell 模式与会话分享 —— 并且收进和其他引擎同一个模型选择器里。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.16 150)",
    to: "oklch(0.68 0.15 190)",
    accent: "oklch(0.88 0.14 165)",
  },
  tags: ["opencode", "harness", "mcp"],
}

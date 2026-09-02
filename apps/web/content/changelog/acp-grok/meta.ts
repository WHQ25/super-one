import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-17",
  category: "feature",
  version: "0.45.3-alpha",
  title: {
    en: "A third engine: any ACP agent, starting with Grok",
    zh: "第三套引擎:任意 ACP agent,从 Grok 开始",
  },
  summary: {
    en: "SuperOne speaks the Agent Client Protocol, so an ACP-compatible agent runs as a first-class harness — same session history, same SuperOne MCP tools, same permission and plan UI. Grok is the first one wired end to end.",
    zh: "SuperOne 现在会说 Agent Client Protocol,于是任何兼容 ACP 的 agent 都能作为一等 harness 运行 —— 同一份会话历史、同一套 SuperOne MCP 工具、同样的权限与计划界面。Grok 是第一个完整接通的。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.6 0.17 285)",
    to: "oklch(0.68 0.13 320)",
    accent: "oklch(0.84 0.14 300)",
  },
  tags: ["acp", "grok", "harness"],
}

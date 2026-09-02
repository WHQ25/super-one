import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-05",
  category: "feature",
  version: "0.43.12-alpha",
  title: {
    en: "A browser inside the app — and inside the agent's tool surface",
    zh: "应用内的浏览器 —— 也是 agent 的工具面",
  },
  summary: {
    en: "The activity panel gains a real browser with tabs, bookmarks and history. The same browser is exposed to every harness as MCP automation tools, so an agent can navigate, read and act on a page you are both looking at.",
    zh: "活动面板里多了一个真正的浏览器,带标签页、书签和历史。同一个浏览器以 MCP 自动化工具的形式开放给每个 harness,于是 agent 可以在你们共同看着的页面上导航、阅读和操作。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.15 200)",
    to: "oklch(0.66 0.17 250)",
    accent: "oklch(0.86 0.14 175)",
  },
  tags: ["browser", "mcp", "automation"],
}

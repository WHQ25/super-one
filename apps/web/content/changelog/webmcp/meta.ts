import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-27",
  category: "feature",
  version: "0.58.0-alpha",
  title: {
    en: "WebMCP: pages that bring their own tools",
    zh: "WebMCP:页面自带工具",
  },
  summary: {
    en: "A page can publish tools to the agent viewing it. SuperOne discovers them, gates them behind a per-origin site trust decision, and persists the grant — so a site you trust extends the agent, and one you do not cannot.",
    zh: "页面可以向正在浏览它的 agent 发布工具。SuperOne 会发现它们,用按域的站点信任闸拦一道,并持久化授权 —— 于是你信任的站点扩展 agent,不信任的站点做不到。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.64 0.17 25)",
    to: "oklch(0.68 0.15 340)",
    accent: "oklch(0.86 0.14 10)",
  },
  tags: ["browser", "webmcp", "security"],
}

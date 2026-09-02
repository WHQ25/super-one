import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-19",
  category: "feature",
  version: "0.45.3-alpha",
  title: {
    en: "Save a widget the agent rendered, reuse it later",
    zh: "把 agent 渲染过的 widget 存下来复用",
  },
  summary: {
    en: "Widgets the agent renders in chat can be saved as named templates in a file-backed store, then re-rendered by name from widget_show — so a chart you liked becomes a thing you can ask for again.",
    zh: "agent 在聊天里渲染的 widget 可以存成具名模板放进文件仓库,之后用 widget_show 按名字重新渲染 —— 于是你喜欢的那张图表变成了可以再要一次的东西。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.16 100)",
    to: "oklch(0.7 0.17 145)",
    accent: "oklch(0.88 0.15 120)",
  },
  tags: ["widget", "mcp", "chat"],
}

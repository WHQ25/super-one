import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-15",
  category: "feature",
  version: "0.33.0-alpha",
  title: {
    en: "Mini-apps grow standalone tools, intercepts, and background workers",
    zh: "Mini-app 引入 standalone 工具、intercept 与后台 worker",
  },
  summary: {
    en: "Mini-apps can now render tool calls inline in chat, prompt users mid-tool with HITL intercept iframes, and keep headless workers running outside any window.",
    zh: "Mini-app 现在可以在聊天里就地渲染工具调用、用 intercept iframe 在工具执行中插入用户输入,还能让后台 worker 独立于任何窗口持续运行。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.18 320)",
    to: "oklch(0.68 0.2 280)",
    accent: "oklch(0.85 0.18 200)",
  },
  tags: ["mini-app", "tools", "platform"],
}

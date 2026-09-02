import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-07",
  category: "feature",
  version: "0.29.0-alpha",
  title: {
    en: "Pop a session into its own window",
    zh: "把会话单独弹成一个窗口",
  },
  summary: {
    en: "Right-click any session → Open in Mini Window for a floating, optionally always-on-top chat. Plus Ctrl+Tab to ping-pong between sessions across every project.",
    zh: "右键任一会话 → 在 Mini Window 中打开,得到一个可置顶的浮动聊天。再加上 Ctrl+Tab 在所有项目的会话间快速切换。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.16 200)",
    to: "oklch(0.74 0.18 240)",
    accent: "oklch(0.86 0.18 280)",
  },
  tags: ["window", "session", "shortcut"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-30",
  category: "feature",
  version: "0.49.2-alpha",
  title: {
    en: "Computer Use: grant an agent one app, not your whole machine",
    zh: "Computer Use:把一个应用交给 agent,而不是整台机器",
  },
  summary: {
    en: "Native window capture and accessibility-tree reading let an agent drive a desktop app — scoped per app, granted by dragging its icon into the conversation, and revocable.",
    zh: "原生窗口捕获与辅助功能树读取让 agent 可以操作桌面应用 —— 按应用授权,把图标拖进对话即可授予,随时可收回。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.66 0.16 30)",
    to: "oklch(0.7 0.18 70)",
    accent: "oklch(0.88 0.15 55)",
  },
  tags: ["computer-use", "permissions", "desktop"],
}

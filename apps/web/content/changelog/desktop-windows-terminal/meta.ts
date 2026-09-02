import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-06-05",
  category: "improvement",
  version: "0.41.0-alpha",
  title: {
    en: "Native Windows chrome, terminal themes, and update channels",
    zh: "原生 Windows 窗口、终端主题与更新通道",
  },
  summary: {
    en: "A custom Windows title bar with overlay controls, a dedicated appearance page with terminal color schemes and font selection, and a user-selectable update channel you can switch at runtime.",
    zh: "自定义 Windows 标题栏与覆盖式窗口控件,独立的外观设置页(终端配色与字体选择),以及可在运行时切换的更新通道。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.66 0.13 230)",
    to: "oklch(0.7 0.11 180)",
    accent: "oklch(0.84 0.14 160)",
  },
  tags: ["desktop", "windows", "terminal", "updater"],
}

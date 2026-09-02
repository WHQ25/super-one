import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-17",
  category: "feature",
  version: "0.35.0-alpha",
  title: {
    en: "An integrated terminal, end to end",
    zh: "集成终端,从本地到远程",
  },
  summary: {
    en: "A real PTY-backed terminal lives next to your chat — Unicode 11, clickable links, ⌘F search, drag-to-reorder tabs — and it streams over relay or LAN to mobile.",
    zh: "真正的 PTY 终端就在聊天旁边 —— Unicode 11、可点击链接、⌘F 搜索、可拖拽 tab —— 还能通过 Relay 或 LAN 流式同步到手机。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.32 0.06 240)",
    to: "oklch(0.22 0.03 200)",
    accent: "oklch(0.7 0.2 140)",
  },
  tags: ["terminal", "remote", "coding"],
}

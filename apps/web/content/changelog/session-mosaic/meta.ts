import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-06-29",
  category: "feature",
  version: "0.42.0-alpha",
  title: {
    en: "Session mosaic: split the window between conversations",
    zh: "会话马赛克:把窗口分给多个会话",
  },
  summary: {
    en: "Drag any session into the main area to split it, arrange conversations on a binary split-tree with resizable dividers, and keep every pane live instead of unmounting the ones you are not looking at.",
    zh: "把任意会话拖进主区域即可分屏,用可拖拽分隔线的二叉分割树排布多个对话,并且没在看的那些面板也保持存活,不会被卸载。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.68 0.16 265)",
    to: "oklch(0.72 0.14 220)",
    accent: "oklch(0.85 0.15 190)",
  },
  tags: ["mosaic", "session", "window"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-25",
  category: "feature",
  version: "0.47.2-alpha",
  title: {
    en: "Mark up a plan the way you would mark up a document",
    zh: "像批注文档一样批注计划",
  },
  summary: {
    en: "Plan review gains sticky-note comments anchored to a text selection, with multi-color highlighter pens and a theme-aware palette — so approving a plan can mean editing it rather than accepting or rejecting it whole.",
    zh: "计划评审新增锚定到选区的便签评论,配多色荧光笔和跟随主题的调色板 —— 于是“批准计划”可以意味着修改它,而不是整体接受或整体驳回。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.78 0.16 85)",
    to: "oklch(0.74 0.17 45)",
    accent: "oklch(0.9 0.14 100)",
  },
  tags: ["chat", "plan-mode", "review"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-22",
  category: "feature",
  version: "0.37.0-alpha",
  title: {
    en: "Worktrees, forks, and fuzzy file search",
    zh: "工作树、分叉与模糊文件搜索",
  },
  summary: {
    en: "Hand off uncommitted changes to a dedicated worktree, fork any session from an earlier message, and find files with tree-structured fuzzy search.",
    zh: "把未提交改动平滑切到独立 worktree,从任意历史消息分叉会话,文件树式模糊搜索一并上线。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.18 260)",
    to: "oklch(0.78 0.16 200)",
    accent: "oklch(0.85 0.2 320)",
  },
  tags: ["session", "worktree", "search"],
}

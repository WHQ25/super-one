import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-13",
  category: "feature",
  version: "0.32.0-alpha",
  title: {
    en: "Your sessions name themselves",
    zh: "会话自己起名字",
  },
  summary: {
    en: "The agent now retitles a chat as the topic clarifies. Sessions you've renamed are protected. The new name flips in with a per-character animation across every title surface.",
    zh: "会话主题清晰后,agent 自动重命名;手动改过的会话会被保护住。新名字在六个标题位置以逐字翻转动画上线。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.74 0.16 45)",
    to: "oklch(0.7 0.18 25)",
    accent: "oklch(0.85 0.18 320)",
  },
  tags: ["session", "mcp", "polish"],
}

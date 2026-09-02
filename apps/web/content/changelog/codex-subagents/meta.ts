import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-20",
  category: "feature",
  version: "0.36.0-alpha",
  title: {
    en: "Codex subagents land with unified cards",
    zh: "Codex Subagent 上线,统一卡片呈现",
  },
  summary: {
    en: "Codex workers and forks now render as a unified subagent card with status-aware visuals, brand-specific session icons, and right-click image actions everywhere.",
    zh: "Codex 的 worker 与 fork 现在统一为带状态视觉的 Subagent 卡片,品牌专属的会话图标贯穿 sidebar,图片右键菜单也全场景接入。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.74 0.15 140)",
    to: "oklch(0.7 0.18 80)",
    accent: "oklch(0.86 0.2 45)",
  },
  tags: ["codex", "subagent", "harness"],
}

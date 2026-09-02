import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-06-11",
  category: "feature",
  version: "0.41.6-alpha",
  title: {
    en: "Liquid Glass mode",
    zh: "Liquid Glass 毛玻璃模式",
  },
  summary: {
    en: "An opt-in translucent dark theme with frosted surfaces, backed by a cleaned-up design-token system and new success / warning / error status colors.",
    zh: "可选的半透明暗色主题,带磨砂质感界面;底层同步整理了设计 token 体系,新增 success / warning / error 状态色。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.62 0.13 250)",
    to: "oklch(0.7 0.1 210)",
    accent: "oklch(0.88 0.12 200)",
  },
  tags: ["theme", "appearance", "design-tokens"],
}

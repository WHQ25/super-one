import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-20",
  category: "improvement",
  version: "0.55.2-alpha",
  title: {
    en: "Light mode, rebuilt as inverted chrome",
    zh: "浅色模式按反转 chrome 重建",
  },
  summary: {
    en: "Light mode was rebuilt from the token layer up rather than lightened from the dark theme, with the brand fill deepened and its ink derived by contrast instead of picked by hand.",
    zh: "浅色模式从 token 层重建,而不是把暗色主题调亮;品牌填充色加深,其上的墨色按对比度推导而不是手工挑选。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.8 0.12 70)",
    to: "oklch(0.84 0.1 40)",
    accent: "oklch(0.6 0.16 30)",
  },
  tags: ["theme", "appearance", "design-tokens"],
}

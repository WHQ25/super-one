import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-05",
  category: "feature",
  version: "0.27.0-alpha",
  title: {
    en: "Token usage stats, Claude hooks, and mini-app mic + camera",
    zh: "Token 用量统计、Claude Hooks 与 Mini-app 麦克风/摄像头",
  },
  summary: {
    en: "A new Usage tab visualizes tokens over time. Mini-apps can now request media permissions per manifest. A dedicated Claude hooks settings page lets you wire all five hook types across scopes.",
    zh: "新的 Usage 标签把 token 用量按时间可视化;Mini-app 可在 manifest 里声明媒体权限;新的 Claude Hooks 设置页让你跨作用域配置全部 5 种 hook。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.17 220)",
    to: "oklch(0.72 0.16 280)",
    accent: "oklch(0.86 0.18 320)",
  },
  tags: ["analytics", "hooks", "mini-app"],
}

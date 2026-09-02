import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-13",
  category: "feature",
  version: "0.53.2-alpha",
  title: {
    en: "Cursor Agent becomes the fifth engine",
    zh: "Cursor Agent 成为第五套引擎",
  },
  summary: {
    en: "The native @cursor/sdk is wired end to end — MCP, cloud sessions, recovery, permission modes, a sandbox toggle and the full model parameter surface, all in a harness-scoped settings home.",
    zh: "原生 @cursor/sdk 完整接通 —— MCP、云端会话、恢复、权限模式、沙盒开关和完整的模型参数面,都收在按 harness 划分的设置页里。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.62 0.08 230)",
    to: "oklch(0.7 0.06 250)",
    accent: "oklch(0.84 0.1 220)",
  },
  tags: ["cursor", "harness", "settings"],
}

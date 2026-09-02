import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-06-13",
  category: "feature",
  version: "0.41.8-alpha",
  title: {
    en: "Live usage, rate limits, and model fallback",
    zh: "实时用量、额度上限与模型回退",
  },
  summary: {
    en: "See Claude and Codex usage in real time, watch ChatGPT subscription rate limits in the sidebar, and get a clear indicator whenever a request falls back to another model.",
    zh: "实时查看 Claude 与 Codex 用量,在 sidebar 跟踪 ChatGPT 订阅额度上限,请求回退到其他模型时也有明确提示。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.17 150)",
    to: "oklch(0.74 0.16 230)",
    accent: "oklch(0.85 0.18 110)",
  },
  tags: ["usage", "claude", "codex"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-19",
  category: "feature",
  version: "0.55.1-alpha",
  title: {
    en: "DeepSeek runs in-process as the sixth engine",
    zh: "DeepSeek 以进程内方式成为第六套引擎",
  },
  summary: {
    en: "The dsh harness is embedded in-process rather than spawned: SuperOne serves its credentials, mounts its native tool plane per session, bridges its own MCP surface in, and renders its trajectory as a foldable panel.",
    zh: "dsh harness 以进程内嵌入的方式运行而非外部进程:SuperOne 供给它的凭据、按会话挂载它的原生工具面、把自身的 MCP 面桥接进去,并把它的轨迹渲染成可折叠面板。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.6 0.19 265)",
    to: "oklch(0.68 0.16 295)",
    accent: "oklch(0.84 0.15 275)",
  },
  tags: ["deepseek", "harness", "mcp"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-30",
  category: "feature",
  version: "0.40.0-alpha",
  title: {
    en: "Phase-grouped workflow agents and structured output",
    zh: "分阶段 Workflow Agent 与结构化输出",
  },
  summary: {
    en: "Parallel subagents now group by phase into a single workflow view, StructuredOutput renders as a first-class tool card, and the markdown editor gains a table slash command with link-safety checks.",
    zh: "并行 subagent 现在按阶段聚合为单一 Workflow 视图,StructuredOutput 以一等工具卡片呈现,markdown 编辑器也新增带链接安全校验的表格斜杠命令。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.16 60)",
    to: "oklch(0.72 0.17 30)",
    accent: "oklch(0.85 0.18 90)",
  },
  tags: ["workflow", "subagent", "markdown-editor"],
}

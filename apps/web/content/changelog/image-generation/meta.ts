import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-07",
  category: "feature",
  version: "0.43.13-alpha",
  title: {
    en: "Image generation, for the agent and for you",
    zh: "图像生成,给 agent 也给你",
  },
  summary: {
    en: "SuperOne gains an image generation service exposed both as a chat action and as an MCP tool, so an agent can produce an asset mid-task instead of describing one it cannot make.",
    zh: "SuperOne 新增图像生成服务,既是聊天里的操作,也是一个 MCP 工具 —— agent 可以在任务中途直接产出素材,而不是描述一个它做不出来的东西。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.72 0.19 340)",
    to: "oklch(0.76 0.17 30)",
    accent: "oklch(0.88 0.14 60)",
  },
  tags: ["media-gen", "mcp", "chat"],
}

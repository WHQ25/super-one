import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-21",
  category: "feature",
  version: "0.46.0-alpha",
  title: {
    en: "Video generation across Sora, Veo, Seedance and Ark",
    zh: "视频生成:Sora、Veo、Seedance 与火山 Ark",
  },
  summary: {
    en: "Video wire protocols join the platform registry, media_generate_video lands on the MCP surface with a per-provider guide, and generated clips render as gallery cards with live status — behind an explicit confirmation, because video costs real money.",
    zh: "视频 wire protocol 进入平台注册表,media_generate_video 登上 MCP 面并带上分 provider 的说明,生成的片段以带实时状态的图库卡片呈现 —— 且需要明确确认,因为视频是真花钱的。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.66 0.19 300)",
    to: "oklch(0.72 0.18 355)",
    accent: "oklch(0.86 0.15 330)",
  },
  tags: ["media-gen", "video", "mcp"],
}

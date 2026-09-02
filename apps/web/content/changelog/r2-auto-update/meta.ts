import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-06",
  category: "announcement",
  version: "0.28.1-alpha",
  title: {
    en: "Auto-update moved to Cloudflare R2",
    zh: "自动更新迁移到 Cloudflare R2",
  },
  summary: {
    en: "Releases now ship from a Cloudflare R2 bucket fronted by https://dl.super-one.dev. No embedded tokens, faster downloads worldwide, and existing clients migrate themselves.",
    zh: "发布走 Cloudflare R2,前置 https://dl.super-one.dev。客户端不再内嵌 token,全球下载更快,老客户端一次升级后自动迁移。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.18 30)",
    to: "oklch(0.72 0.18 60)",
    accent: "oklch(0.86 0.18 200)",
  },
  tags: ["infra", "release"],
}

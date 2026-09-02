import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-19",
  category: "improvement",
  version: "0.45.3-alpha",
  title: {
    en: "Providers, rebuilt around capabilities instead of names",
    zh: "Provider 体系按能力重建,不再按名字",
  },
  summary: {
    en: "A capability-based provider registry replaces the per-vendor special cases: endpoints are grouped into families, models are discovered from the endpoint and classified against the local models.dev catalog, and everything a custom platform declares is editable.",
    zh: "以能力为中心的 provider 注册表取代了逐家厂商的特例:端点归入 family,模型直接从端点发现并对照本地 models.dev 目录分类,自定义平台声明的一切都可以编辑。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.16 165)",
    to: "oklch(0.68 0.14 215)",
    accent: "oklch(0.86 0.15 140)",
  },
  tags: ["providers", "models", "settings"],
}

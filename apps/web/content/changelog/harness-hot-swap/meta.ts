import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-12",
  category: "improvement",
  version: "0.53.0-alpha",
  title: {
    en: "Harnesses install on demand — nothing is bundled anymore",
    zh: "Harness 按需安装 —— 不再内置任何二进制",
  },
  summary: {
    en: "Platform binaries left the app bundle. Harnesses are fetched from an R2 mirror when you enable one, the installer is shared between desktop and CLI, and first run scans for CLIs you already have.",
    zh: "平台二进制离开了应用包。启用某个 harness 时才从 R2 镜像获取,安装器在桌面端与 CLI 之间共用,首次运行会扫描你已经装好的 CLI。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.17 55)",
    to: "oklch(0.72 0.15 20)",
    accent: "oklch(0.88 0.14 40)",
  },
  tags: ["harness", "infra", "onboarding"],
}

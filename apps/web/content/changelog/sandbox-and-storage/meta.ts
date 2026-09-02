import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-11",
  category: "improvement",
  version: "0.30.5-alpha",
  title: {
    en: "Per-platform sandbox, storage permissions, semantic process names",
    zh: "按平台沙箱、存储权限、Activity Monitor 里能认出每个子进程",
  },
  summary: {
    en: "Sandbox is opt-in per OS with macOS defaulting on. Mini-apps can declare Web Storage permissions. Helper processes finally carry distinct names so Activity Monitor stops being a wall of \"SuperOne Helper\".",
    zh: "沙箱按操作系统区分开关,macOS 默认开。Mini-app 可声明 Web Storage 权限。辅助进程在 Activity Monitor / ps 里终于不再全叫 \"SuperOne Helper\"。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.68 0.18 30)",
    to: "oklch(0.7 0.16 50)",
    accent: "oklch(0.86 0.18 200)",
  },
  tags: ["security", "mini-app", "infra"],
}

import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-08-06",
  category: "feature",
  version: "0.50.1-alpha",
  title: {
    en: "Remote nodes: run the agent on another machine, keep the desktop",
    zh: "远程节点:agent 跑在另一台机器上,桌面还是这个桌面",
  },
  summary: {
    en: "A headless superone CLI turns any Linux box or workstation into a node. Sessions run there while the desktop stays the interface — and desktop-bound tools like the browser are delegated back over a host action channel.",
    zh: "无头的 superone CLI 把任意 Linux 机器或工作站变成一个节点。会话在那边运行,桌面仍然是界面 —— 浏览器这类依赖桌面的工具会经由 host action 通道委派回来。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.62 0.15 240)",
    to: "oklch(0.68 0.13 195)",
    accent: "oklch(0.84 0.14 215)",
  },
  tags: ["remote", "cli", "infra"],
}

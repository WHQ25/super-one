import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-06-08",
  category: "feature",
  version: "0.41.4-alpha",
  title: {
    en: "Share desktop files to your phone",
    zh: "把桌面文件分享到手机",
  },
  summary: {
    en: "A new mobile_share_file tool lets the agent push files from your desktop to the connected phone, with live upload progress and a lightweight stat-only read for metadata.",
    zh: "新增 mobile_share_file 工具,agent 可把桌面文件推送到已连接的手机,带实时上传进度;另有轻量的 stat-only 读取用于获取元数据。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.18 300)",
    to: "oklch(0.74 0.16 350)",
    accent: "oklch(0.86 0.16 320)",
  },
  tags: ["remote", "mobile", "mcp"],
}

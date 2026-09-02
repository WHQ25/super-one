import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-05-05",
  category: "feature",
  version: "0.27.4-alpha",
  title: {
    en: "End-to-end encrypted file transfer for remote control",
    zh: "Remote Control 文件传输全链路加密",
  },
  summary: {
    en: "Files routed through the relay are now wrapped in AES-GCM with chunked AAD; R2 never sees plaintext. Plus drag files out of the sidebar into Finder or any sandbox.",
    zh: "经 Relay 转发的文件用 AES-GCM 分块封装,R2 看不到任何明文。Sidebar 文件可以原生拖入 Finder 或沙箱 mini-app。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.7 0.16 160)",
    to: "oklch(0.66 0.18 200)",
    accent: "oklch(0.86 0.18 80)",
  },
  tags: ["security", "remote", "relay"],
}

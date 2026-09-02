import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-09-02",
  category: "feature",
  version: "0.60.1-alpha",
  title: {
    en: "Talk to Codex, and read it back as a timeline",
    zh: "对 Codex 说话,再把它读成一条时间线",
  },
  summary: {
    en: "Realtime voice sessions for Codex, with voice and delegated work rendered in one ordered transcript, a ready cue before you start speaking, and local persistence so a call is still there tomorrow.",
    zh: "Codex 的实时语音会话:语音与被委派的工作渲染在同一条有序的对话记录里,开口前有就绪提示,并在本地持久化,于是通话明天还在。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.66 0.18 320)",
    to: "oklch(0.7 0.16 250)",
    accent: "oklch(0.86 0.14 285)",
  },
  tags: ["codex", "voice", "chat"],
}

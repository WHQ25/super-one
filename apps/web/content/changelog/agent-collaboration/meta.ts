import type { ChangelogMeta } from "../types"

export const meta: ChangelogMeta = {
  date: "2026-07-28",
  category: "feature",
  version: "0.48.3-alpha",
  title: {
    en: "Sessions that can talk to each other",
    zh: "会话之间可以互相对话",
  },
  summary: {
    en: "A session can spawn a child, hand work to a sibling, or open a mailbox with an existing session — across harness boundaries, and only after you approve the launch.",
    zh: "一个会话可以派生子会话、把工作移交给同级,或与已有会话建立信箱 —— 跨越 harness 边界,并且只有在你批准这次启动之后。",
  },
  hero: {
    type: "gradient",
    from: "oklch(0.68 0.18 275)",
    to: "oklch(0.72 0.16 330)",
    accent: "oklch(0.86 0.15 300)",
  },
  tags: ["collab", "session", "mcp"],
}

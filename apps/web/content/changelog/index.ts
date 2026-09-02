import type { ChangelogEntry } from "./types"

import { meta as liveUsageAndFallbackMeta } from "./live-usage-and-fallback/meta"
import LiveUsageAndFallbackEn from "./live-usage-and-fallback/en.mdx"
import LiveUsageAndFallbackZh from "./live-usage-and-fallback/zh.mdx"

import { meta as liquidGlassMeta } from "./liquid-glass/meta"
import LiquidGlassEn from "./liquid-glass/en.mdx"
import LiquidGlassZh from "./liquid-glass/zh.mdx"

import { meta as mobileFileSharingMeta } from "./mobile-file-sharing/meta"
import MobileFileSharingEn from "./mobile-file-sharing/en.mdx"
import MobileFileSharingZh from "./mobile-file-sharing/zh.mdx"

import { meta as desktopWindowsTerminalMeta } from "./desktop-windows-terminal/meta"
import DesktopWindowsTerminalEn from "./desktop-windows-terminal/en.mdx"
import DesktopWindowsTerminalZh from "./desktop-windows-terminal/zh.mdx"

import { meta as workflowAndStructuredOutputMeta } from "./workflow-and-structured-output/meta"
import WorkflowAndStructuredOutputEn from "./workflow-and-structured-output/en.mdx"
import WorkflowAndStructuredOutputZh from "./workflow-and-structured-output/zh.mdx"

import { meta as worktreesAndForksMeta } from "./worktrees-and-forks/meta"
import WorktreesAndForksEn from "./worktrees-and-forks/en.mdx"
import WorktreesAndForksZh from "./worktrees-and-forks/zh.mdx"

import { meta as codexSubagentsMeta } from "./codex-subagents/meta"
import CodexSubagentsEn from "./codex-subagents/en.mdx"
import CodexSubagentsZh from "./codex-subagents/zh.mdx"

import { meta as integratedTerminalMeta } from "./integrated-terminal/meta"
import IntegratedTerminalEn from "./integrated-terminal/en.mdx"
import IntegratedTerminalZh from "./integrated-terminal/zh.mdx"

import { meta as miniAppPlatformMeta } from "./mini-app-platform/meta"
import MiniAppPlatformEn from "./mini-app-platform/en.mdx"
import MiniAppPlatformZh from "./mini-app-platform/zh.mdx"

import { meta as aiSessionRenameMeta } from "./ai-session-rename/meta"
import AiSessionRenameEn from "./ai-session-rename/en.mdx"
import AiSessionRenameZh from "./ai-session-rename/zh.mdx"

import { meta as sandboxAndStorageMeta } from "./sandbox-and-storage/meta"
import SandboxAndStorageEn from "./sandbox-and-storage/en.mdx"
import SandboxAndStorageZh from "./sandbox-and-storage/zh.mdx"

import { meta as miniWindowMeta } from "./mini-window-and-multi-window/meta"
import MiniWindowEn from "./mini-window-and-multi-window/en.mdx"
import MiniWindowZh from "./mini-window-and-multi-window/zh.mdx"

import { meta as r2AutoUpdateMeta } from "./r2-auto-update/meta"
import R2AutoUpdateEn from "./r2-auto-update/en.mdx"
import R2AutoUpdateZh from "./r2-auto-update/zh.mdx"

import { meta as mobileRemoteMeta } from "./mobile-remote-and-encryption/meta"
import MobileRemoteEn from "./mobile-remote-and-encryption/en.mdx"
import MobileRemoteZh from "./mobile-remote-and-encryption/zh.mdx"

import { meta as usageAndHooksMeta } from "./usage-and-hooks/meta"
import UsageAndHooksEn from "./usage-and-hooks/en.mdx"
import UsageAndHooksZh from "./usage-and-hooks/zh.mdx"

export const changelogEntries: ChangelogEntry[] = [
  {
    ...liveUsageAndFallbackMeta,
    slug: "live-usage-and-fallback",
    body: { en: LiveUsageAndFallbackEn, zh: LiveUsageAndFallbackZh },
  },
  {
    ...liquidGlassMeta,
    slug: "liquid-glass",
    body: { en: LiquidGlassEn, zh: LiquidGlassZh },
  },
  {
    ...mobileFileSharingMeta,
    slug: "mobile-file-sharing",
    body: { en: MobileFileSharingEn, zh: MobileFileSharingZh },
  },
  {
    ...desktopWindowsTerminalMeta,
    slug: "desktop-windows-terminal",
    body: { en: DesktopWindowsTerminalEn, zh: DesktopWindowsTerminalZh },
  },
  {
    ...workflowAndStructuredOutputMeta,
    slug: "workflow-and-structured-output",
    body: { en: WorkflowAndStructuredOutputEn, zh: WorkflowAndStructuredOutputZh },
  },
  {
    ...worktreesAndForksMeta,
    slug: "worktrees-and-forks",
    body: { en: WorktreesAndForksEn, zh: WorktreesAndForksZh },
  },
  {
    ...codexSubagentsMeta,
    slug: "codex-subagents",
    body: { en: CodexSubagentsEn, zh: CodexSubagentsZh },
  },
  {
    ...integratedTerminalMeta,
    slug: "integrated-terminal",
    body: { en: IntegratedTerminalEn, zh: IntegratedTerminalZh },
  },
  {
    ...miniAppPlatformMeta,
    slug: "mini-app-platform",
    body: { en: MiniAppPlatformEn, zh: MiniAppPlatformZh },
  },
  {
    ...aiSessionRenameMeta,
    slug: "ai-session-rename",
    body: { en: AiSessionRenameEn, zh: AiSessionRenameZh },
  },
  {
    ...sandboxAndStorageMeta,
    slug: "sandbox-and-storage",
    body: { en: SandboxAndStorageEn, zh: SandboxAndStorageZh },
  },
  {
    ...miniWindowMeta,
    slug: "mini-window-and-multi-window",
    body: { en: MiniWindowEn, zh: MiniWindowZh },
  },
  {
    ...r2AutoUpdateMeta,
    slug: "r2-auto-update",
    body: { en: R2AutoUpdateEn, zh: R2AutoUpdateZh },
  },
  {
    ...mobileRemoteMeta,
    slug: "mobile-remote-and-encryption",
    body: { en: MobileRemoteEn, zh: MobileRemoteZh },
  },
  {
    ...usageAndHooksMeta,
    slug: "usage-and-hooks",
    body: { en: UsageAndHooksEn, zh: UsageAndHooksZh },
  },
]

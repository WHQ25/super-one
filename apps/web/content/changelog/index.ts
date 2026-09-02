import type { ChangelogEntry } from "./types"

import { meta as realtimeVoiceMeta } from "./realtime-voice/meta"
import RealtimeVoiceEn from "./realtime-voice/en.mdx"
import RealtimeVoiceZh from "./realtime-voice/zh.mdx"

import { meta as webmcpMeta } from "./webmcp/meta"
import WebmcpEn from "./webmcp/en.mdx"
import WebmcpZh from "./webmcp/zh.mdx"

import { meta as deviceControlMeta } from "./device-control/meta"
import DeviceControlEn from "./device-control/en.mdx"
import DeviceControlZh from "./device-control/zh.mdx"

import { meta as lightModeRebuildMeta } from "./light-mode-rebuild/meta"
import LightModeRebuildEn from "./light-mode-rebuild/en.mdx"
import LightModeRebuildZh from "./light-mode-rebuild/zh.mdx"

import { meta as deepseekHarnessMeta } from "./deepseek-harness/meta"
import DeepseekHarnessEn from "./deepseek-harness/en.mdx"
import DeepseekHarnessZh from "./deepseek-harness/zh.mdx"

import { meta as cursorHarnessMeta } from "./cursor-harness/meta"
import CursorHarnessEn from "./cursor-harness/en.mdx"
import CursorHarnessZh from "./cursor-harness/zh.mdx"

import { meta as harnessHotSwapMeta } from "./harness-hot-swap/meta"
import HarnessHotSwapEn from "./harness-hot-swap/en.mdx"
import HarnessHotSwapZh from "./harness-hot-swap/zh.mdx"

import { meta as remoteNodesMeta } from "./remote-nodes/meta"
import RemoteNodesEn from "./remote-nodes/en.mdx"
import RemoteNodesZh from "./remote-nodes/zh.mdx"

import { meta as computerUseMeta } from "./computer-use/meta"
import ComputerUseEn from "./computer-use/en.mdx"
import ComputerUseZh from "./computer-use/zh.mdx"

import { meta as agentCollaborationMeta } from "./agent-collaboration/meta"
import AgentCollaborationEn from "./agent-collaboration/en.mdx"
import AgentCollaborationZh from "./agent-collaboration/zh.mdx"

import { meta as planCommentsMeta } from "./plan-comments/meta"
import PlanCommentsEn from "./plan-comments/en.mdx"
import PlanCommentsZh from "./plan-comments/zh.mdx"

import { meta as opencodeHarnessMeta } from "./opencode-harness/meta"
import OpencodeHarnessEn from "./opencode-harness/en.mdx"
import OpencodeHarnessZh from "./opencode-harness/zh.mdx"

import { meta as videoGenerationMeta } from "./video-generation/meta"
import VideoGenerationEn from "./video-generation/en.mdx"
import VideoGenerationZh from "./video-generation/zh.mdx"

import { meta as widgetTemplatesMeta } from "./widget-templates/meta"
import WidgetTemplatesEn from "./widget-templates/en.mdx"
import WidgetTemplatesZh from "./widget-templates/zh.mdx"

import { meta as providerRegistryMeta } from "./provider-registry/meta"
import ProviderRegistryEn from "./provider-registry/en.mdx"
import ProviderRegistryZh from "./provider-registry/zh.mdx"

import { meta as acpGrokMeta } from "./acp-grok/meta"
import AcpGrokEn from "./acp-grok/en.mdx"
import AcpGrokZh from "./acp-grok/zh.mdx"

import { meta as imageGenerationMeta } from "./image-generation/meta"
import ImageGenerationEn from "./image-generation/en.mdx"
import ImageGenerationZh from "./image-generation/zh.mdx"

import { meta as embeddedBrowserMeta } from "./embedded-browser/meta"
import EmbeddedBrowserEn from "./embedded-browser/en.mdx"
import EmbeddedBrowserZh from "./embedded-browser/zh.mdx"

import { meta as sessionMosaicMeta } from "./session-mosaic/meta"
import SessionMosaicEn from "./session-mosaic/en.mdx"
import SessionMosaicZh from "./session-mosaic/zh.mdx"

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

import { meta as miniWindowAndMultiWindowMeta } from "./mini-window-and-multi-window/meta"
import MiniWindowAndMultiWindowEn from "./mini-window-and-multi-window/en.mdx"
import MiniWindowAndMultiWindowZh from "./mini-window-and-multi-window/zh.mdx"

import { meta as r2AutoUpdateMeta } from "./r2-auto-update/meta"
import R2AutoUpdateEn from "./r2-auto-update/en.mdx"
import R2AutoUpdateZh from "./r2-auto-update/zh.mdx"

import { meta as mobileRemoteAndEncryptionMeta } from "./mobile-remote-and-encryption/meta"
import MobileRemoteAndEncryptionEn from "./mobile-remote-and-encryption/en.mdx"
import MobileRemoteAndEncryptionZh from "./mobile-remote-and-encryption/zh.mdx"

import { meta as usageAndHooksMeta } from "./usage-and-hooks/meta"
import UsageAndHooksEn from "./usage-and-hooks/en.mdx"
import UsageAndHooksZh from "./usage-and-hooks/zh.mdx"

export const changelogEntries: ChangelogEntry[] = [
  {
    ...realtimeVoiceMeta,
    slug: "realtime-voice",
    body: { en: RealtimeVoiceEn, zh: RealtimeVoiceZh },
  },
  {
    ...webmcpMeta,
    slug: "webmcp",
    body: { en: WebmcpEn, zh: WebmcpZh },
  },
  {
    ...deviceControlMeta,
    slug: "device-control",
    body: { en: DeviceControlEn, zh: DeviceControlZh },
  },
  {
    ...lightModeRebuildMeta,
    slug: "light-mode-rebuild",
    body: { en: LightModeRebuildEn, zh: LightModeRebuildZh },
  },
  {
    ...deepseekHarnessMeta,
    slug: "deepseek-harness",
    body: { en: DeepseekHarnessEn, zh: DeepseekHarnessZh },
  },
  {
    ...cursorHarnessMeta,
    slug: "cursor-harness",
    body: { en: CursorHarnessEn, zh: CursorHarnessZh },
  },
  {
    ...harnessHotSwapMeta,
    slug: "harness-hot-swap",
    body: { en: HarnessHotSwapEn, zh: HarnessHotSwapZh },
  },
  {
    ...remoteNodesMeta,
    slug: "remote-nodes",
    body: { en: RemoteNodesEn, zh: RemoteNodesZh },
  },
  {
    ...computerUseMeta,
    slug: "computer-use",
    body: { en: ComputerUseEn, zh: ComputerUseZh },
  },
  {
    ...agentCollaborationMeta,
    slug: "agent-collaboration",
    body: { en: AgentCollaborationEn, zh: AgentCollaborationZh },
  },
  {
    ...planCommentsMeta,
    slug: "plan-comments",
    body: { en: PlanCommentsEn, zh: PlanCommentsZh },
  },
  {
    ...opencodeHarnessMeta,
    slug: "opencode-harness",
    body: { en: OpencodeHarnessEn, zh: OpencodeHarnessZh },
  },
  {
    ...videoGenerationMeta,
    slug: "video-generation",
    body: { en: VideoGenerationEn, zh: VideoGenerationZh },
  },
  {
    ...widgetTemplatesMeta,
    slug: "widget-templates",
    body: { en: WidgetTemplatesEn, zh: WidgetTemplatesZh },
  },
  {
    ...providerRegistryMeta,
    slug: "provider-registry",
    body: { en: ProviderRegistryEn, zh: ProviderRegistryZh },
  },
  {
    ...acpGrokMeta,
    slug: "acp-grok",
    body: { en: AcpGrokEn, zh: AcpGrokZh },
  },
  {
    ...imageGenerationMeta,
    slug: "image-generation",
    body: { en: ImageGenerationEn, zh: ImageGenerationZh },
  },
  {
    ...embeddedBrowserMeta,
    slug: "embedded-browser",
    body: { en: EmbeddedBrowserEn, zh: EmbeddedBrowserZh },
  },
  {
    ...sessionMosaicMeta,
    slug: "session-mosaic",
    body: { en: SessionMosaicEn, zh: SessionMosaicZh },
  },
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
    ...miniWindowAndMultiWindowMeta,
    slug: "mini-window-and-multi-window",
    body: { en: MiniWindowAndMultiWindowEn, zh: MiniWindowAndMultiWindowZh },
  },
  {
    ...r2AutoUpdateMeta,
    slug: "r2-auto-update",
    body: { en: R2AutoUpdateEn, zh: R2AutoUpdateZh },
  },
  {
    ...mobileRemoteAndEncryptionMeta,
    slug: "mobile-remote-and-encryption",
    body: { en: MobileRemoteAndEncryptionEn, zh: MobileRemoteAndEncryptionZh },
  },
  {
    ...usageAndHooksMeta,
    slug: "usage-and-hooks",
    body: { en: UsageAndHooksEn, zh: UsageAndHooksZh },
  },
]

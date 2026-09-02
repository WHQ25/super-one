import type { ComponentType } from "react"
import type { Locale } from "@/i18n/routing"

import HarnessSwitchEn from "./session/harness-switch/en.mdx"
import HarnessSwitchZh from "./session/harness-switch/zh.mdx"
import ParallelSessionsEn from "./session/parallel-sessions/en.mdx"
import ParallelSessionsZh from "./session/parallel-sessions/zh.mdx"
import WorktreesEn from "./session/worktrees/en.mdx"
import WorktreesZh from "./session/worktrees/zh.mdx"
import InputEditorEn from "./chat/input-editor/en.mdx"
import InputEditorZh from "./chat/input-editor/zh.mdx"
import MiniAppPlatformEn from "./mini-apps/miniapp-platform/en.mdx"
import MiniAppPlatformZh from "./mini-apps/miniapp-platform/zh.mdx"
import MobileRemoteEn from "./remote/mobile-remote/en.mdx"
import MobileRemoteZh from "./remote/mobile-remote/zh.mdx"
import PlanModeEn from "./basics/claude-plan-mode/en.mdx"
import PlanModeZh from "./basics/claude-plan-mode/zh.mdx"
import ClaudeSubagentsEn from "./basics/claude-subagents/en.mdx"
import ClaudeSubagentsZh from "./basics/claude-subagents/zh.mdx"
import PermissionModesEn from "./basics/claude-permission-modes/en.mdx"
import PermissionModesZh from "./basics/claude-permission-modes/zh.mdx"
import BrandHueEn from "./personalization/brand-hue/en.mdx"
import BrandHueZh from "./personalization/brand-hue/zh.mdx"
import CollabSpawnEn from "./collab/spawn/en.mdx"
import CollabSpawnZh from "./collab/spawn/zh.mdx"
import CollabHandoffEn from "./collab/handoff/en.mdx"
import CollabHandoffZh from "./collab/handoff/zh.mdx"
import CollabLinkEn from "./collab/link/en.mdx"
import CollabLinkZh from "./collab/link/zh.mdx"
import BrowserToolsEn from "./browser/browser-tools/en.mdx"
import BrowserToolsZh from "./browser/browser-tools/zh.mdx"
import WebMcpEn from "./browser/webmcp/en.mdx"
import WebMcpZh from "./browser/webmcp/zh.mdx"
import IosSimulatorEn from "./devices/ios-simulator/en.mdx"
import IosSimulatorZh from "./devices/ios-simulator/zh.mdx"
import AndroidDevicesEn from "./devices/android-devices/en.mdx"
import AndroidDevicesZh from "./devices/android-devices/zh.mdx"
import ComputerGrantEn from "./computer-use/computer-grant/en.mdx"
import ComputerGrantZh from "./computer-use/computer-grant/zh.mdx"
import DshRuntimeEn from "./deepseek/dsh-runtime/en.mdx"
import DshRuntimeZh from "./deepseek/dsh-runtime/zh.mdx"
import AcpProtocolEn from "./acp/acp-protocol/en.mdx"
import AcpProtocolZh from "./acp/acp-protocol/zh.mdx"
import OpenCodeRewindEn from "./opencode/opencode-rewind/en.mdx"
import OpenCodeRewindZh from "./opencode/opencode-rewind/zh.mdx"
import CursorCloudEn from "./cursor/cursor-cloud/en.mdx"
import CursorCloudZh from "./cursor/cursor-cloud/zh.mdx"

type Bundle = Record<Locale, ComponentType>

const SUBFEATURE_BODIES: Record<string, Bundle> = {
  "engines/dual-harness/per-session-engine": {
    en: HarnessSwitchEn,
    zh: HarnessSwitchZh,
  },
  "workspace/projects/parallel-sessions": {
    en: ParallelSessionsEn,
    zh: ParallelSessionsZh,
  },
  "workspace/worktrees/move-to-worktree": { en: WorktreesEn, zh: WorktreesZh },
  "conversation/composer/rich-text-editor": {
    en: InputEditorEn,
    zh: InputEditorZh,
  },
  "extend/mini-apps/miniapp-platform": {
    en: MiniAppPlatformEn,
    zh: MiniAppPlatformZh,
  },
  "connect/remote/mobile-remote": { en: MobileRemoteEn, zh: MobileRemoteZh },
  "engines/claude-core/plan-mode": { en: PlanModeEn, zh: PlanModeZh },
  "engines/claude-orchestration/subagents": {
    en: ClaudeSubagentsEn,
    zh: ClaudeSubagentsZh,
  },
  "engines/claude-core/permission-modes": {
    en: PermissionModesEn,
    zh: PermissionModesZh,
  },
  "personalize/theme/brand-hue": { en: BrandHueEn, zh: BrandHueZh },
  "collab/launch-modes/spawn": { en: CollabSpawnEn, zh: CollabSpawnZh },
  "collab/launch-modes/handoff": { en: CollabHandoffEn, zh: CollabHandoffZh },
  "collab/launch-modes/link": { en: CollabLinkEn, zh: CollabLinkZh },
  "extend/browser/browser-tools": { en: BrowserToolsEn, zh: BrowserToolsZh },
  "extend/browser/webmcp": { en: WebMcpEn, zh: WebMcpZh },
  "extend/devices/ios-simulator": { en: IosSimulatorEn, zh: IosSimulatorZh },
  "extend/devices/android-devices": { en: AndroidDevicesEn, zh: AndroidDevicesZh },
  "extend/computer-use/computer-grant": { en: ComputerGrantEn, zh: ComputerGrantZh },
  "engines/deepseek/dsh-runtime": { en: DshRuntimeEn, zh: DshRuntimeZh },
  "engines/acp-agents/acp-protocol": { en: AcpProtocolEn, zh: AcpProtocolZh },
  "engines/opencode/opencode-rewind": { en: OpenCodeRewindEn, zh: OpenCodeRewindZh },
  "engines/cursor-agent/cursor-cloud": { en: CursorCloudEn, zh: CursorCloudZh },
}

export function getSubFeatureBody(
  category: string,
  feature: string,
  sub: string,
  locale: Locale,
): ComponentType | undefined {
  return SUBFEATURE_BODIES[`${category}/${feature}/${sub}`]?.[locale]
}

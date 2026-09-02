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
}

export function getSubFeatureBody(
  category: string,
  feature: string,
  sub: string,
  locale: Locale,
): ComponentType | undefined {
  return SUBFEATURE_BODIES[`${category}/${feature}/${sub}`]?.[locale]
}

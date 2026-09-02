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
import CollabLaunchApprovalEn from "./collab/launch-approval/en.mdx"
import CollabLaunchApprovalZh from "./collab/launch-approval/zh.mdx"
import CollabMailboxEn from "./collab/mailbox/en.mdx"
import CollabMailboxZh from "./collab/mailbox/zh.mdx"
import CollabMentionsEn from "./collab/collab-mentions/en.mdx"
import CollabMentionsZh from "./collab/collab-mentions/zh.mdx"
import CollabWorktreeIsolationEn from "./collab/worktree-isolation/en.mdx"
import CollabWorktreeIsolationZh from "./collab/worktree-isolation/zh.mdx"
import CollabChildProjectsEn from "./collab/child-projects/en.mdx"
import CollabChildProjectsZh from "./collab/child-projects/zh.mdx"
import CollabCrossHarnessEn from "./collab/cross-harness/en.mdx"
import CollabCrossHarnessZh from "./collab/cross-harness/zh.mdx"
import DarkModeEn from "./personalization/dark-mode/en.mdx"
import DarkModeZh from "./personalization/dark-mode/zh.mdx"
import WindowStyleEn from "./personalization/window-style/en.mdx"
import WindowStyleZh from "./personalization/window-style/zh.mdx"
import AutoUpdateEn from "./personalization/auto-update/en.mdx"
import AutoUpdateZh from "./personalization/auto-update/zh.mdx"
import ProjectManagementEn from "./workspace/project-management/en.mdx"
import ProjectManagementZh from "./workspace/project-management/zh.mdx"
import SessionHistoryEn from "./workspace/session-history/en.mdx"
import SessionHistoryZh from "./workspace/session-history/zh.mdx"
import SessionForkEn from "./workspace/session-fork/en.mdx"
import SessionForkZh from "./workspace/session-fork/zh.mdx"
import ForkToWorktreeEn from "./workspace/fork-to-worktree/en.mdx"
import ForkToWorktreeZh from "./workspace/fork-to-worktree/zh.mdx"
import FileTreeEn from "./workspace/file-tree/en.mdx"
import FileTreeZh from "./workspace/file-tree/zh.mdx"
import FuzzySearchEn from "./workspace/fuzzy-search/en.mdx"
import FuzzySearchZh from "./workspace/fuzzy-search/zh.mdx"
import FilePreviewEn from "./workspace/file-preview/en.mdx"
import FilePreviewZh from "./workspace/file-preview/zh.mdx"
import IntegratedTerminalEn from "./workspace/integrated-terminal/en.mdx"
import IntegratedTerminalZh from "./workspace/integrated-terminal/zh.mdx"
import SlashMenuEn from "./conversation/slash-menu/en.mdx"
import SlashMenuZh from "./conversation/slash-menu/zh.mdx"
import MentionsEn from "./conversation/mentions/en.mdx"
import MentionsZh from "./conversation/mentions/zh.mdx"
import MarkdownRenderingEn from "./conversation/markdown-rendering/en.mdx"
import MarkdownRenderingZh from "./conversation/markdown-rendering/zh.mdx"
import ThinkingBlocksEn from "./conversation/thinking-blocks/en.mdx"
import ThinkingBlocksZh from "./conversation/thinking-blocks/zh.mdx"
import FileChipEn from "./conversation/file-chip/en.mdx"
import FileChipZh from "./conversation/file-chip/zh.mdx"
import ActivityPanelEn from "./conversation/activity-panel/en.mdx"
import ActivityPanelZh from "./conversation/activity-panel/zh.mdx"
import SwitchAnytimeEn from "./engines/switch-anytime/en.mdx"
import SwitchAnytimeZh from "./engines/switch-anytime/zh.mdx"
import EffortThinkingEn from "./engines/effort-thinking/en.mdx"
import EffortThinkingZh from "./engines/effort-thinking/zh.mdx"
import ClaudeModelsEn from "./engines/claude-models/en.mdx"
import ClaudeModelsZh from "./engines/claude-models/zh.mdx"
import ClaudeSlashCommandsEn from "./engines/claude-slash-commands/en.mdx"
import ClaudeSlashCommandsZh from "./engines/claude-slash-commands/zh.mdx"
import TodosTasksEn from "./engines/todos-tasks/en.mdx"
import TodosTasksZh from "./engines/todos-tasks/zh.mdx"
import AskUserEn from "./engines/ask-user/en.mdx"
import AskUserZh from "./engines/ask-user/zh.mdx"
import PermissionSandboxEn from "./engines/permission-sandbox/en.mdx"
import PermissionSandboxZh from "./engines/permission-sandbox/zh.mdx"
import CodexActionsEn from "./engines/codex-actions/en.mdx"
import CodexActionsZh from "./engines/codex-actions/zh.mdx"
import CodexModelsEn from "./engines/codex-models/en.mdx"
import CodexModelsZh from "./engines/codex-models/zh.mdx"
import ForkRollbackEn from "./engines/fork-rollback/en.mdx"
import ForkRollbackZh from "./engines/fork-rollback/zh.mdx"
import CursorModelsEn from "./engines/cursor-models/en.mdx"
import CursorModelsZh from "./engines/cursor-models/zh.mdx"
import CursorPermissionsEn from "./engines/cursor-permissions/en.mdx"
import CursorPermissionsZh from "./engines/cursor-permissions/zh.mdx"
import OpenCodeAgentsEn from "./engines/opencode-agents/en.mdx"
import OpenCodeAgentsZh from "./engines/opencode-agents/zh.mdx"
import OpenCodeMcpEn from "./engines/opencode-mcp/en.mdx"
import OpenCodeMcpZh from "./engines/opencode-mcp/zh.mdx"
import OpenCodeShellEn from "./engines/opencode-shell/en.mdx"
import OpenCodeShellZh from "./engines/opencode-shell/zh.mdx"
import DshToolPlaneEn from "./engines/dsh-tool-plane/en.mdx"
import DshToolPlaneZh from "./engines/dsh-tool-plane/zh.mdx"
import DshTrajectoryEn from "./engines/dsh-trajectory/en.mdx"
import DshTrajectoryZh from "./engines/dsh-trajectory/zh.mdx"
import DshPresetsEn from "./engines/dsh-presets/en.mdx"
import DshPresetsZh from "./engines/dsh-presets/zh.mdx"
import AcpToolsEn from "./engines/acp-tools/en.mdx"
import AcpToolsZh from "./engines/acp-tools/zh.mdx"
import AcpPlanEn from "./engines/acp-plan/en.mdx"
import AcpPlanZh from "./engines/acp-plan/zh.mdx"
import AcpSuperoneToolsEn from "./engines/acp-superone-tools/en.mdx"
import AcpSuperoneToolsZh from "./engines/acp-superone-tools/zh.mdx"
import McpServersEn from "./extend/mcp-servers/en.mdx"
import McpServersZh from "./extend/mcp-servers/zh.mdx"
import SkillsEn from "./extend/skills/en.mdx"
import SkillsZh from "./extend/skills/zh.mdx"
import SubagentsLibraryEn from "./extend/subagents-library/en.mdx"
import SubagentsLibraryZh from "./extend/subagents-library/zh.mdx"
import PluginsEn from "./extend/plugins/en.mdx"
import PluginsZh from "./extend/plugins/zh.mdx"
import HooksEn from "./extend/hooks/en.mdx"
import HooksZh from "./extend/hooks/zh.mdx"
import MemoryInstructionsEn from "./extend/memory-instructions/en.mdx"
import MemoryInstructionsZh from "./extend/memory-instructions/zh.mdx"
import WidgetShowEn from "./extend/widget-show/en.mdx"
import WidgetShowZh from "./extend/widget-show/zh.mdx"
import WidgetModulesEn from "./extend/widget-modules/en.mdx"
import WidgetModulesZh from "./extend/widget-modules/zh.mdx"
import MiniAppInstallEn from "./extend/miniapp-install/en.mdx"
import MiniAppInstallZh from "./extend/miniapp-install/zh.mdx"
import MiniAppOverlayApiEn from "./extend/miniapp-overlay-api/en.mdx"
import MiniAppOverlayApiZh from "./extend/miniapp-overlay-api/zh.mdx"
import MiniAppDevEn from "./extend/miniapp-dev/en.mdx"
import MiniAppDevZh from "./extend/miniapp-dev/zh.mdx"
import BrowserPanelEn from "./extend/browser-panel/en.mdx"
import BrowserPanelZh from "./extend/browser-panel/zh.mdx"
import BrowserAnnotateEn from "./extend/browser-annotate/en.mdx"
import BrowserAnnotateZh from "./extend/browser-annotate/zh.mdx"
import DevicePanelEn from "./extend/device-panel/en.mdx"
import DevicePanelZh from "./extend/device-panel/zh.mdx"
import ComputerCaptureEn from "./extend/computer-capture/en.mdx"
import ComputerCaptureZh from "./extend/computer-capture/zh.mdx"
import ImageGenerationEn from "./extend/image-generation/en.mdx"
import ImageGenerationZh from "./extend/image-generation/zh.mdx"
import VideoGenerationEn from "./extend/video-generation/en.mdx"
import VideoGenerationZh from "./extend/video-generation/zh.mdx"
import MultiMobileEn from "./connect/multi-mobile/en.mdx"
import MultiMobileZh from "./connect/multi-mobile/zh.mdx"
import E2eEncryptionEn from "./connect/e2e-encryption/en.mdx"
import E2eEncryptionZh from "./connect/e2e-encryption/zh.mdx"
import SelfHostedRelayEn from "./connect/self-hosted-relay/en.mdx"
import SelfHostedRelayZh from "./connect/self-hosted-relay/zh.mdx"
import ScheduledAgentsEn from "./connect/scheduled-agents/en.mdx"
import ScheduledAgentsZh from "./connect/scheduled-agents/zh.mdx"
import BackgroundTasksEn from "./connect/background-tasks/en.mdx"
import BackgroundTasksZh from "./connect/background-tasks/zh.mdx"
import ClaudeProvidersEn from "./connect/claude-providers/en.mdx"
import ClaudeProvidersZh from "./connect/claude-providers/zh.mdx"
import ClaudeCustomGatewayEn from "./connect/claude-custom-gateway/en.mdx"
import ClaudeCustomGatewayZh from "./connect/claude-custom-gateway/zh.mdx"
import CodexAuthEn from "./connect/codex-auth/en.mdx"
import CodexAuthZh from "./connect/codex-auth/zh.mdx"
import CodexCustomProvidersEn from "./connect/codex-custom-providers/en.mdx"
import CodexCustomProvidersZh from "./connect/codex-custom-providers/zh.mdx"

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
  "collab/collab-control/launch-approval": { en: CollabLaunchApprovalEn, zh: CollabLaunchApprovalZh },
  "collab/collab-control/mailbox": { en: CollabMailboxEn, zh: CollabMailboxZh },
  "collab/collab-control/collab-mentions": { en: CollabMentionsEn, zh: CollabMentionsZh },
  "collab/collab-isolation/worktree-isolation": { en: CollabWorktreeIsolationEn, zh: CollabWorktreeIsolationZh },
  "collab/collab-isolation/child-projects": { en: CollabChildProjectsEn, zh: CollabChildProjectsZh },
  "collab/collab-isolation/cross-harness": { en: CollabCrossHarnessEn, zh: CollabCrossHarnessZh },
  "personalize/theme/dark-mode": { en: DarkModeEn, zh: DarkModeZh },
  "personalize/window/window-style": { en: WindowStyleEn, zh: WindowStyleZh },
  "personalize/window/auto-update": { en: AutoUpdateEn, zh: AutoUpdateZh },
  "workspace/projects/project-management": { en: ProjectManagementEn, zh: ProjectManagementZh },
  "workspace/projects/session-history": { en: SessionHistoryEn, zh: SessionHistoryZh },
  "workspace/projects/session-fork": { en: SessionForkEn, zh: SessionForkZh },
  "workspace/worktrees/fork-to-worktree": { en: ForkToWorktreeEn, zh: ForkToWorktreeZh },
  "workspace/files/file-tree": { en: FileTreeEn, zh: FileTreeZh },
  "workspace/files/fuzzy-search": { en: FuzzySearchEn, zh: FuzzySearchZh },
  "workspace/files/file-preview": { en: FilePreviewEn, zh: FilePreviewZh },
  "workspace/files/integrated-terminal": { en: IntegratedTerminalEn, zh: IntegratedTerminalZh },
  "conversation/composer/slash-menu": { en: SlashMenuEn, zh: SlashMenuZh },
  "conversation/composer/mentions": { en: MentionsEn, zh: MentionsZh },
  "conversation/replies/markdown-rendering": { en: MarkdownRenderingEn, zh: MarkdownRenderingZh },
  "conversation/replies/thinking-blocks": { en: ThinkingBlocksEn, zh: ThinkingBlocksZh },
  "conversation/replies/file-chip": { en: FileChipEn, zh: FileChipZh },
  "conversation/replies/activity-panel": { en: ActivityPanelEn, zh: ActivityPanelZh },
  "engines/dual-harness/switch-anytime": { en: SwitchAnytimeEn, zh: SwitchAnytimeZh },
  "engines/claude-core/effort-thinking": { en: EffortThinkingEn, zh: EffortThinkingZh },
  "engines/claude-core/models": { en: ClaudeModelsEn, zh: ClaudeModelsZh },
  "engines/claude-core/slash-commands": { en: ClaudeSlashCommandsEn, zh: ClaudeSlashCommandsZh },
  "engines/claude-orchestration/todos-tasks": { en: TodosTasksEn, zh: TodosTasksZh },
  "engines/claude-orchestration/ask-user": { en: AskUserEn, zh: AskUserZh },
  "engines/codex-core/permission-sandbox": { en: PermissionSandboxEn, zh: PermissionSandboxZh },
  "engines/codex-core/codex-actions": { en: CodexActionsEn, zh: CodexActionsZh },
  "engines/codex-core/codex-models": { en: CodexModelsEn, zh: CodexModelsZh },
  "engines/codex-advanced/fork-rollback": { en: ForkRollbackEn, zh: ForkRollbackZh },
  "engines/cursor-agent/cursor-models": { en: CursorModelsEn, zh: CursorModelsZh },
  "engines/cursor-agent/cursor-permissions": { en: CursorPermissionsEn, zh: CursorPermissionsZh },
  "engines/opencode/opencode-agents": { en: OpenCodeAgentsEn, zh: OpenCodeAgentsZh },
  "engines/opencode/opencode-mcp": { en: OpenCodeMcpEn, zh: OpenCodeMcpZh },
  "engines/opencode/opencode-shell": { en: OpenCodeShellEn, zh: OpenCodeShellZh },
  "engines/deepseek/dsh-tool-plane": { en: DshToolPlaneEn, zh: DshToolPlaneZh },
  "engines/deepseek/dsh-trajectory": { en: DshTrajectoryEn, zh: DshTrajectoryZh },
  "engines/deepseek/dsh-presets": { en: DshPresetsEn, zh: DshPresetsZh },
  "engines/acp-agents/acp-tools": { en: AcpToolsEn, zh: AcpToolsZh },
  "engines/acp-agents/acp-plan": { en: AcpPlanEn, zh: AcpPlanZh },
  "engines/acp-agents/acp-superone-tools": { en: AcpSuperoneToolsEn, zh: AcpSuperoneToolsZh },
  "extend/resources/mcp-servers": { en: McpServersEn, zh: McpServersZh },
  "extend/resources/skills": { en: SkillsEn, zh: SkillsZh },
  "extend/resources/subagents-library": { en: SubagentsLibraryEn, zh: SubagentsLibraryZh },
  "extend/resources/plugins": { en: PluginsEn, zh: PluginsZh },
  "extend/resources/hooks": { en: HooksEn, zh: HooksZh },
  "extend/resources/memory-instructions": { en: MemoryInstructionsEn, zh: MemoryInstructionsZh },
  "extend/widgets/widget-show": { en: WidgetShowEn, zh: WidgetShowZh },
  "extend/widgets/widget-modules": { en: WidgetModulesEn, zh: WidgetModulesZh },
  "extend/mini-apps/miniapp-install": { en: MiniAppInstallEn, zh: MiniAppInstallZh },
  "extend/mini-apps/miniapp-overlay-api": { en: MiniAppOverlayApiEn, zh: MiniAppOverlayApiZh },
  "extend/mini-apps/miniapp-dev": { en: MiniAppDevEn, zh: MiniAppDevZh },
  "extend/browser/browser-panel": { en: BrowserPanelEn, zh: BrowserPanelZh },
  "extend/browser/browser-annotate": { en: BrowserAnnotateEn, zh: BrowserAnnotateZh },
  "extend/devices/device-panel": { en: DevicePanelEn, zh: DevicePanelZh },
  "extend/computer-use/computer-capture": { en: ComputerCaptureEn, zh: ComputerCaptureZh },
  "extend/media-generation/image-generation": { en: ImageGenerationEn, zh: ImageGenerationZh },
  "extend/media-generation/video-generation": { en: VideoGenerationEn, zh: VideoGenerationZh },
  "connect/remote/multi-mobile": { en: MultiMobileEn, zh: MultiMobileZh },
  "connect/remote/e2e-encryption": { en: E2eEncryptionEn, zh: E2eEncryptionZh },
  "connect/remote/self-hosted-relay": { en: SelfHostedRelayEn, zh: SelfHostedRelayZh },
  "connect/automation/scheduled-agents": { en: ScheduledAgentsEn, zh: ScheduledAgentsZh },
  "connect/automation/background-tasks": { en: BackgroundTasksEn, zh: BackgroundTasksZh },
  "connect/providers/claude-providers": { en: ClaudeProvidersEn, zh: ClaudeProvidersZh },
  "connect/providers/claude-custom-gateway": { en: ClaudeCustomGatewayEn, zh: ClaudeCustomGatewayZh },
  "connect/providers/codex-auth": { en: CodexAuthEn, zh: CodexAuthZh },
  "connect/providers/codex-custom-providers": { en: CodexCustomProvidersEn, zh: CodexCustomProvidersZh },
}

export function getSubFeatureBody(
  category: string,
  feature: string,
  sub: string,
  locale: Locale,
): ComponentType | undefined {
  return SUBFEATURE_BODIES[`${category}/${feature}/${sub}`]?.[locale]
}

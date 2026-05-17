export { NewSessionMock, type NewSessionMockProps } from "./new-session-mock"
export {
  ChatMock,
  ChatBody,
  type ChatMockProps,
  type ChatBodyProps,
  type MockMessage,
  type MockMessageRole,
  type MockBlock,
} from "./chat-mock"
export {
  DesktopShell,
  DesktopSidebar,
  DesktopMainHeader,
  type DesktopShellProps,
  type DesktopSidebarProps,
  type DesktopMainHeaderProps,
  type MockProject,
  type MockSession,
  type MockAutomation,
  type MockWorker,
  type MockPinnedSession,
  type MockApp,
  type AutomationStatus,
  type SessionStatus,
  type SidebarTab,
} from "./desktop-shell"
export { ChatInputMock, type ChatInputMockProps } from "./chat-input-mock"
export {
  ChatInputAdvancedMock,
  type ChatInputAdvancedMockProps,
  type ChatInputDirHintMock,
  type ChatInputDirScope,
  type MentionChipMock,
  type MentionChipKind,
  type PasteChipMock,
  type ImageThumbnailKind,
  type ImageAttachmentMock,
  type PdfAttachmentMock,
  type AttachmentMock,
  type MiniAppContextChipMock,
  type UserSelectionChipMock,
  type MentionPopupMock,
  type MentionPopupItemMock,
  type SlashPopupMock,
  type SlashCommandSuggestionMock,
} from "./chat-input-advanced-mock"
export {
  ToolBlockMock,
  SandboxNetworkBanner,
  type ToolBlockMockProps,
  type ToolBlockSpec,
} from "./tool-block-mock"
export {
  SubagentBlockMock,
  SUBAGENT_COLOR_POOL,
  type SubagentBlockMockProps,
  type SubagentBlockState,
  type SubagentColorName,
  type SubagentChildToolMock,
  type SubagentAsyncToolMock,
} from "./subagent-block-mock"
export {
  PermissionPromptMock,
  type PermissionPromptMockProps,
  type PermissionAction,
  type PermissionMode,
  type PermissionSuggestion,
  type ElicitationField,
} from "./permission-prompt-mock"
export {
  PlanApprovalMock,
  type PlanApprovalMockProps,
  type PlanApprovalAction,
} from "./plan-approval-mock"
export {
  AskUserQuestionMock,
  type AskUserQuestionMockProps,
  type MockUserQuestion,
  type MockQuestionOption,
} from "./ask-user-question-mock"
export {
  TodoPopupMock,
  type TodoPopupMockProps,
  type TodoPopupItem,
  type TodoStatus,
} from "./todo-popup-mock"
export {
  FileTreeMock,
  SAMPLE_FILE_TREE,
  type FileTreeMockProps,
  type FileTreeNode,
  type FileTreeGitStatus,
} from "./file-tree-mock"
export {
  FilePreviewMock,
  type FilePreviewMockProps,
  type FilePreviewSpec,
} from "./file-preview-mock"
export {
  ChatStatusBarMock,
  CodexPermissionPopoverMock,
  EffortSelectorPopoverMock,
  GitBranchPopoverMock,
  ModelEffortTriggerStrip,
  ModelSelectorPopoverMock,
  PermissionModePopoverMock,
  PopoverShell,
  SandboxModePopoverMock,
  StatusBarTrigger,
  WorktreePopoverMock,
  type ChatStatusBarMockProps,
  type CodexPermissionId,
  type CodexPermissionPopoverMockProps,
  type EffortLevel,
  type EffortSelectorPopoverMockProps,
  type GitBranchDirty,
  type GitBranchPopoverMockProps,
  type ModelEffortTriggerStripProps,
  type ModelEntry,
  type ModelSelectorPopoverMockProps,
  type PermissionModeId,
  type PermissionModePopoverMockProps,
  type PopoverShellProps,
  type SandboxModeId,
  type SandboxModePopoverMockProps,
  type StatusBarTriggerProps,
  type WorktreeEntryMock,
  type WorktreePopoverMockProps,
} from "./chat-popovers-mock"
export {
  AddDirSlashPopupMock,
  McpSlashPopupMock,
  ProviderSlashPopupMock,
  type AddDirEntryMock,
  type AddDirSlashPopupMockProps,
  type AddDirSlashVariant,
  type McpServerEntryMock,
  type McpServerStatusMock,
  type McpSlashPopupMockProps,
  type McpSlashVariant,
  type ProviderBrandKey,
  type ProviderItemMock,
  type ProviderSlashPopupMockProps,
} from "./slash-popups-mock"
export {
  AUTOMATION_ROW_CONTEXT_MENU,
  ContextMenuMock,
  FILE_QUOTE_CONTEXT_MENU,
  FILE_ROW_CONTEXT_MENU,
  FOLDER_ROW_CONTEXT_MENU,
  IMAGE_CONTEXT_MENU,
  PROJECT_ROW_CONTEXT_MENU,
  SESSION_ROW_CONTEXT_MENU,
  TEXT_SELECTION_CONTEXT_MENU,
  type ContextMenuEntry,
  type ContextMenuItemMock,
  type ContextMenuItemVariant,
  type ContextMenuLabelMock,
  type ContextMenuMockProps,
  type ContextMenuSeparatorMock,
} from "./context-menu-mock"
export { ShimmerText, type ShimmerTextProps } from "./shimmer-text"
export { RollingNumber, type RollingNumberProps } from "./rolling-number"
export { ClaudeAgentIcon, CodexAgentIcon, type Harness } from "./icons"
export {
  BrandScope,
  HARNESS_CLAUDE_HUE,
  HARNESS_CODEX_HUE,
  type BrandScopeProps,
} from "./brand-scope"
export {
  MockLocaleProvider,
  useMockT,
  useMockLocale,
  createT,
  type MockT,
} from "./i18n"

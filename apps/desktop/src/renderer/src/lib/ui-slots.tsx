import { Component, type ErrorInfo, type ReactNode } from 'react'
import { createSlotRegistry, type SlotRegistry } from '@superone/ui-slots'

export interface ChatToolBlockSlotProps {
  toolName: string
  toolUseId?: string
  input: string
  params: Record<string, unknown>
  toolSummary?: string
  filePath?: string
  status?: 'streaming' | 'complete'
  isStreaming: boolean
  elapsedSeconds?: number
  result?: string
  cleanResult?: string
  isError?: boolean
  isDenied: boolean
  isTimedOut?: boolean
  allowExpand: boolean
  grouped: boolean
}

export interface SessionHeaderActionSlotProps {
  sessionId: string
  projectPath: string | null
}

export interface ActivityPluginPanelSlotProps {
  panelKey: string
  pluginId?: string
  title?: string
  params: Record<string, unknown>
}

export interface SessionProvidersSlotProps {
  children: ReactNode
}

export interface WorkspaceViewSlotProps {
  mosaicMode: 'single' | 'mosaic'
  compact: boolean
  scope?: { projectPath: string; sessionId: string }
}

export interface ChatTranscriptSlotProps {
  sessionId?: string | null
  projectPath?: string | null
  showRealtime: boolean
}

export interface ChatComposerSlotProps {
  sessionId?: string | null
  projectPath?: string | null
  composerKind: string
}

export interface ChatStatusBarSlotProps {
  sessionId?: string | null
  projectPath?: string | null
}

export interface ChatStatusBarItemSlotProps {
  sessionId?: string | null
  projectPath?: string | null
  compact: boolean
}

export interface ChatEmptyStateSlotProps {
  draftMode: boolean
  sessionId?: string | null
  projectPath?: string | null
}

export interface ChatMessageRowSlotProps {
  messageId: string
  role: 'user' | 'assistant' | 'system'
  isStreaming: boolean
  sessionId?: string | null
  projectPath?: string | null
  children: ReactNode
}

export interface ChatAssistantActionSlotProps {
  message: unknown
  copyText?: string
  isStreaming: boolean
}

export interface ChatMarkdownFenceSlotProps {
  kind: 'code' | 'mermaid'
  code: string
  language: string
  isComplete: boolean
}

export interface ChatComposerAreaSlotProps {
  sessionId?: string | null
  projectPath?: string | null
  compact?: boolean
}

export interface ActivityLauncherSlotProps {
  groupId?: string
}

export interface ShellTitlebarContentSlotProps {
  showLayoutControls: boolean
}

export interface ShellSidebarContentSlotProps {
  open?: boolean
}

export interface ShellActivityContentSlotProps {
  visible?: boolean
}

export interface ShellSettingsPageSlotProps {
  area: 'nav' | 'content'
  activeTab: string
  onSelectTab: (tabId: string) => void
}

export interface ShellOverlayItemSlotProps {
  view: string
}

export interface SidebarTabSlotProps {
  area: 'tab' | 'content'
  activeTab: string
  onSelectTab: (tabId: string) => void
}

export interface SidebarDrawerSlotProps {
  open?: boolean
}

export interface SidebarFooterActionSlotProps {}

export interface SidebarSessionRowTrailingSlotProps {
  sessionId: string
  folderPath: string
  provider: string
  isActive: boolean
}

declare module '@superone/ui-slots' {
  interface SlotMap {
    'session.providers': { kind: 'hoc'; props: SessionProvidersSlotProps }
    'session.header.actions': { kind: 'list'; props: SessionHeaderActionSlotProps }
    'activity.panel': { kind: 'keyed'; props: ActivityPluginPanelSlotProps; key: string }
    'activity.launcher': { kind: 'list'; props: ActivityLauncherSlotProps }
    'chat.toolBlock': { kind: 'chain'; props: ChatToolBlockSlotProps }
    'workspace.view': { kind: 'chain'; props: WorkspaceViewSlotProps }
    'chat.transcript': { kind: 'chain'; props: ChatTranscriptSlotProps }
    'chat.composer': { kind: 'chain'; props: ChatComposerSlotProps }
    'chat.statusBar': { kind: 'chain'; props: ChatStatusBarSlotProps }
    'chat.statusBar.left': { kind: 'list'; props: ChatStatusBarItemSlotProps }
    'chat.statusBar.right': { kind: 'list'; props: ChatStatusBarItemSlotProps }
    'chat.emptyState': { kind: 'chain'; props: ChatEmptyStateSlotProps }
    'chat.message.row': { kind: 'hoc'; props: ChatMessageRowSlotProps }
    'chat.message.assistant.actions': { kind: 'list'; props: ChatAssistantActionSlotProps }
    'chat.markdown.fence': { kind: 'chain'; props: ChatMarkdownFenceSlotProps }
    'chat.composer.dock.top': { kind: 'list'; props: ChatComposerAreaSlotProps }
    'chat.composer.toolbar.left': { kind: 'list'; props: ChatComposerAreaSlotProps }
    'chat.composer.toolbar.right': { kind: 'list'; props: ChatComposerAreaSlotProps }
    'shell.titlebar.content': { kind: 'single'; props: ShellTitlebarContentSlotProps }
    'shell.sidebar.content': { kind: 'single'; props: ShellSidebarContentSlotProps }
    'shell.activity.content': { kind: 'single'; props: ShellActivityContentSlotProps }
    'shell.settings.pages': { kind: 'list'; props: ShellSettingsPageSlotProps }
    'shell.overlay.items': { kind: 'list'; props: ShellOverlayItemSlotProps }
    'sidebar.tabs': { kind: 'list'; props: SidebarTabSlotProps }
    'sidebar.drawer': { kind: 'list'; props: SidebarDrawerSlotProps }
    'sidebar.footer.actions': { kind: 'list'; props: SidebarFooterActionSlotProps }
    'sidebar.session.row.trailing': { kind: 'list'; props: SidebarSessionRowTrailingSlotProps }
  }
}

let appSlotRegistry: SlotRegistry | null = null

export function getAppSlotRegistry(): SlotRegistry {
  if (!appSlotRegistry) {
    appSlotRegistry = createSlotRegistry()
  }
  return appSlotRegistry
}

export function resetAppSlotRegistryForTest(): void {
  appSlotRegistry = null
}

interface ErrorBoundaryProps {
  resetKey?: string
  fallback: ReactNode | (() => ReactNode)
  onError?: (error: Error, info: ErrorInfo) => void
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  capturedResetKey?: string
}

export class PluginSlotErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, capturedResetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<ErrorBoundaryState> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(props: ErrorBoundaryProps, state: ErrorBoundaryState): Partial<ErrorBoundaryState> | null {
    if (props.resetKey !== state.capturedResetKey) {
      return { hasError: false, capturedResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return typeof this.props.fallback === 'function' ? this.props.fallback() : this.props.fallback
    }
    return this.props.children
  }
}

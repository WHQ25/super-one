import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type {
  ChainSlotEntry,
  HocSlotEntry,
  KeyedSlotEntry,
  ListSlotEntry,
  SingleSlotEntry,
  SlotDisposer,
  SlotScopeHandle,
} from '@superone/ui-slots'
import type {
  CommandDefinition,
  CommandMiddleware,
  KernelDisposer,
  KeybindingDefinition,
  LayoutActionResult,
  LayoutOpenPanelRequest,
  MenuContext,
  MenuId,
  MenuItemDefinition,
  ThemeLayerDefinition,
} from '@superone/client-kernel'
import type { DshPluginRpcResult } from '@superone/shared/dsh-plugin-client'

export type {
  CommandDefinition,
  CommandMiddleware,
  KernelDisposer,
  KeybindingContext,
  KeybindingDefinition,
  LayoutActionResult,
  LayoutOpenPanelRequest,
  MenuContext,
  MenuId,
  MenuItemDefinition,
  ThemeLayerDefinition,
  ThemeScope,
} from '@superone/client-kernel'

export const PLUGIN_SDK_API_VERSION = 1 as const

export interface PluginSessionSnapshot {
  sessionId: string | null
  projectPath: string | null
  provider: string | null
  status: string | null
  title: string | null
}

export interface PluginThemeSnapshot {
  resolvedTheme: 'light' | 'dark'
}

export interface PluginToolBlockProps {
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

export interface PluginActivityPanelProps {
  panelKey: string
  pluginId?: string
  title?: string
  params: Record<string, unknown>
}

export interface PluginHeaderActionProps {
  sessionId: string
  projectPath: string | null
}

export interface PluginComposerAreaProps {
  sessionId?: string | null
  projectPath?: string | null
  compact?: boolean
}

export interface PluginMarkdownFenceProps {
  kind: 'code' | 'mermaid'
  code: string
  language: string
  isComplete: boolean
}

export interface PluginMessageRowProps {
  messageId: string
  role: 'user' | 'assistant' | 'system'
  isStreaming: boolean
  sessionId?: string | null
  projectPath?: string | null
  children: ReactNode
}

export interface PluginAssistantActionProps {
  message: unknown
  copyText?: string
  isStreaming: boolean
}

export interface PluginStatusBarItemProps {
  sessionId?: string | null
  projectPath?: string | null
  compact: boolean
}

export interface PluginSidebarTabProps {
  area: 'tab' | 'content'
  activeTab: string
  onSelectTab: (tabId: string) => void
}

export interface PluginSidebarDrawerProps {
  open?: boolean
}

export interface PluginSidebarFooterActionProps {}

export interface PluginSidebarSessionRowTrailingProps {
  sessionId: string
  folderPath: string
  provider: string
  isActive: boolean
}

export interface PluginWorkspaceViewProps {
  mosaicMode: 'single' | 'mosaic'
  compact: boolean
  scope?: { projectPath: string; sessionId: string }
}

export interface PluginChatTranscriptProps {
  sessionId?: string | null
  projectPath?: string | null
  showRealtime: boolean
}

export interface PluginChatComposerProps {
  sessionId?: string | null
  projectPath?: string | null
  composerKind: string
}

export interface PluginChatStatusBarProps {
  sessionId?: string | null
  projectPath?: string | null
}

export interface PluginChatEmptyStateProps {
  draftMode: boolean
  sessionId?: string | null
  projectPath?: string | null
}

export interface PluginActivityLauncherProps {
  groupId?: string
}

export interface PluginShellTitlebarContentProps {
  showLayoutControls: boolean
}

export interface PluginShellSidebarContentProps {
  open?: boolean
}

export interface PluginShellActivityContentProps {
  visible?: boolean
}

export interface PluginShellSettingsPageProps {
  area: 'nav' | 'content'
  activeTab: string
  onSelectTab: (tabId: string) => void
}

export interface PluginShellOverlayItemProps {
  view: string
}

export interface PluginSlotMap {
  'session.providers': { kind: 'hoc'; props: { children: ReactNode } }
  'session.header.actions': { kind: 'list'; props: PluginHeaderActionProps }
  'activity.panel': { kind: 'keyed'; props: PluginActivityPanelProps; key: string }
  'activity.launcher': { kind: 'list'; props: PluginActivityLauncherProps }
  'chat.toolBlock': { kind: 'chain'; props: PluginToolBlockProps }
  'workspace.view': { kind: 'chain'; props: PluginWorkspaceViewProps }
  'chat.transcript': { kind: 'chain'; props: PluginChatTranscriptProps }
  'chat.composer': { kind: 'chain'; props: PluginChatComposerProps }
  'chat.statusBar': { kind: 'chain'; props: PluginChatStatusBarProps }
  'chat.statusBar.left': { kind: 'list'; props: PluginStatusBarItemProps }
  'chat.statusBar.right': { kind: 'list'; props: PluginStatusBarItemProps }
  'chat.emptyState': { kind: 'chain'; props: PluginChatEmptyStateProps }
  'chat.message.row': { kind: 'hoc'; props: PluginMessageRowProps }
  'chat.message.assistant.actions': { kind: 'list'; props: PluginAssistantActionProps }
  'chat.markdown.fence': { kind: 'chain'; props: PluginMarkdownFenceProps }
  'chat.composer.dock.top': { kind: 'list'; props: PluginComposerAreaProps }
  'chat.composer.toolbar.left': { kind: 'list'; props: PluginComposerAreaProps }
  'chat.composer.toolbar.right': { kind: 'list'; props: PluginComposerAreaProps }
  'sidebar.tabs': { kind: 'list'; props: PluginSidebarTabProps }
  'sidebar.drawer': { kind: 'list'; props: PluginSidebarDrawerProps }
  'sidebar.footer.actions': { kind: 'list'; props: PluginSidebarFooterActionProps }
  'sidebar.session.row.trailing': { kind: 'list'; props: PluginSidebarSessionRowTrailingProps }
  'shell.titlebar.content': { kind: 'single'; props: PluginShellTitlebarContentProps }
  'shell.sidebar.content': { kind: 'single'; props: PluginShellSidebarContentProps }
  'shell.activity.content': { kind: 'single'; props: PluginShellActivityContentProps }
  'shell.settings.pages': { kind: 'list'; props: PluginShellSettingsPageProps }
  'shell.overlay.items': { kind: 'list'; props: PluginShellOverlayItemProps }
}

export interface PluginActivityPanelApi {
  openPanel(panelKey: string, title: string, params?: Record<string, unknown>): void
  closePanel(panelKey: string): void
}

export interface PluginRpcClient {
  invoke<T = unknown>(method: string, payload?: unknown): Promise<DshPluginRpcResult<T>>
  on(event: string, callback: (payload: unknown) => void): () => void
}

export interface PluginCommandsApi {
  registerCommand(definition: CommandDefinition): KernelDisposer
  registerMiddleware(commandId: string | '*', middleware: CommandMiddleware, priority?: number): KernelDisposer
  executeCommand<Result = unknown>(id: string, ...args: unknown[]): Promise<Result>
}

export interface PluginKeybindingsApi {
  registerKeybinding(definition: KeybindingDefinition): KernelDisposer
}

export interface PluginMenusApi {
  registerMenuItem(menuId: MenuId, item: MenuItemDefinition): KernelDisposer
}

export interface PluginLayoutApi {
  openPanel(request: LayoutOpenPanelRequest): Promise<LayoutActionResult>
  closePanel(panelIdOrKey: string): Promise<LayoutActionResult>
  focusPanel(panelIdOrKey: string): Promise<LayoutActionResult>
  toggleSidebar(open?: boolean): Promise<LayoutActionResult>
  toggleActivityPanel(open?: boolean): Promise<LayoutActionResult>
  setChatMode(mode: 'docked' | 'floating' | 'icon'): Promise<LayoutActionResult>
}

export interface PluginThemeApi {
  registerLayer(layer: ThemeLayerDefinition): KernelDisposer
}

export interface PluginSlotRegistrar {
  registerToolBlock(entry: ChainSlotEntry<PluginToolBlockProps, ReactNode>): SlotDisposer
  registerActivityPanel(
    panelKey: string,
    entry: KeyedSlotEntry<PluginActivityPanelProps, ComponentType<PluginActivityPanelProps>>,
  ): SlotDisposer
  registerHeaderAction(
    entry: ListSlotEntry<PluginHeaderActionProps, ComponentType<PluginHeaderActionProps>>,
  ): SlotDisposer
  registerSessionProvider(
    entry: HocSlotEntry<{ children: ReactNode }, ComponentType<{ children: ReactNode }>>,
  ): SlotDisposer
  registerComposerToolbarRight(
    entry: ListSlotEntry<PluginComposerAreaProps, ComponentType<PluginComposerAreaProps>>,
  ): SlotDisposer
  registerComposerToolbarLeft(
    entry: ListSlotEntry<PluginComposerAreaProps, ComponentType<PluginComposerAreaProps>>,
  ): SlotDisposer
  registerMarkdownFence(
    entry: ChainSlotEntry<PluginMarkdownFenceProps, ReactNode>,
  ): SlotDisposer
  registerMessageRow(
    entry: HocSlotEntry<PluginMessageRowProps, ComponentType<PluginMessageRowProps>>,
  ): SlotDisposer
  registerAssistantAction(
    entry: ListSlotEntry<PluginAssistantActionProps, ComponentType<PluginAssistantActionProps>>,
  ): SlotDisposer
  registerStatusBarItem(
    side: 'left' | 'right',
    entry: ListSlotEntry<PluginStatusBarItemProps, ComponentType<PluginStatusBarItemProps>>,
  ): SlotDisposer
  registerSidebarTab(
    entry: ListSlotEntry<PluginSidebarTabProps, ComponentType<PluginSidebarTabProps>>,
  ): SlotDisposer
  registerSidebarDrawer(
    entry: ListSlotEntry<PluginSidebarDrawerProps, ComponentType<PluginSidebarDrawerProps>>,
  ): SlotDisposer
  registerSidebarFooterAction(
    entry: ListSlotEntry<PluginSidebarFooterActionProps, ComponentType<PluginSidebarFooterActionProps>>,
  ): SlotDisposer
  registerSidebarSessionRowTrailing(
    entry: ListSlotEntry<PluginSidebarSessionRowTrailingProps, ComponentType<PluginSidebarSessionRowTrailingProps>>,
  ): SlotDisposer
  registerSingle<K extends keyof PluginSlotMap & string>(
    slot: K,
    entry: SingleSlotEntry<PluginSlotMap[K]['props'], ComponentType<PluginSlotMap[K]['props']>>,
  ): SlotDisposer
  registerList<K extends keyof PluginSlotMap & string>(
    slot: K,
    entry: ListSlotEntry<PluginSlotMap[K]['props'], ComponentType<PluginSlotMap[K]['props']>>,
  ): SlotDisposer
  registerKeyed<K extends keyof PluginSlotMap & string>(
    slot: K,
    key: string,
    entry: KeyedSlotEntry<PluginSlotMap[K]['props'], ComponentType<PluginSlotMap[K]['props']>>,
  ): SlotDisposer
  registerChain<K extends keyof PluginSlotMap & string>(
    slot: K,
    entry: ChainSlotEntry<PluginSlotMap[K]['props'], ReactNode>,
  ): SlotDisposer
  registerHoc<K extends keyof PluginSlotMap & string>(
    slot: K,
    entry: HocSlotEntry<PluginSlotMap[K]['props'], ComponentType<PluginSlotMap[K]['props']>>,
  ): SlotDisposer
}

export interface SuperoneClientPluginContext {
  apiVersion: 1
  pluginId: string
  scope: SlotScopeHandle
  slots: PluginSlotRegistrar
  commands: PluginCommandsApi
  keybindings: PluginKeybindingsApi
  menus: PluginMenusApi
  layout: PluginLayoutApi
  theme: PluginThemeApi
  rpc: PluginRpcClient
  activity: PluginActivityPanelApi
  onDispose(fn: () => void): SlotDisposer
}

export type SuperoneClientPluginActivate = (
  ctx: SuperoneClientPluginContext,
) => void | (() => void) | Promise<void | (() => void)>

export type SuperoneClientPlugin =
  | SuperoneClientPluginActivate
  | { activate: SuperoneClientPluginActivate }

export interface PluginSdkHostAdapter {
  useSession(): PluginSessionSnapshot
  useTheme(): PluginThemeSnapshot
  openPanel(panelKey: string, title: string, params?: Record<string, unknown>): void
  closePanel(panelKey: string): void
}

const DEFAULT_SESSION_SNAPSHOT: PluginSessionSnapshot = {
  sessionId: null,
  projectPath: null,
  provider: null,
  status: null,
  title: null,
}

const DEFAULT_THEME_SNAPSHOT: PluginThemeSnapshot = {
  resolvedTheme: 'dark',
}

let activeHostAdapter: PluginSdkHostAdapter | null = null
const adapterListeners = new Set<() => void>()

export function setPluginSdkHostAdapter(adapter: PluginSdkHostAdapter | null): void {
  activeHostAdapter = adapter
  for (const listener of adapterListeners) listener()
}

function subscribeAdapter(listener: () => void): () => void {
  adapterListeners.add(listener)
  return () => {
    adapterListeners.delete(listener)
  }
}

function getAdapter(): PluginSdkHostAdapter | null {
  return activeHostAdapter
}

const DEFAULT_ADAPTER: PluginSdkHostAdapter = {
  useSession: () => DEFAULT_SESSION_SNAPSHOT,
  useTheme: () => DEFAULT_THEME_SNAPSHOT,
  openPanel: () => {},
  closePanel: () => {},
}

export function usePluginSession(): PluginSessionSnapshot {
  const adapter = useSyncExternalStore(subscribeAdapter, getAdapter, getAdapter)
  return (adapter ?? DEFAULT_ADAPTER).useSession()
}

export function usePluginTheme(): PluginThemeSnapshot {
  const adapter = useSyncExternalStore(subscribeAdapter, getAdapter, getAdapter)
  return (adapter ?? DEFAULT_ADAPTER).useTheme()
}

export function usePluginActivityPanel(): PluginActivityPanelApi {
  return {
    openPanel: (panelKey, title, params) => activeHostAdapter?.openPanel(panelKey, title, params),
    closePanel: (panelKey) => activeHostAdapter?.closePanel(panelKey),
  }
}

export function createSlotRegistrar(scope: SlotScopeHandle): PluginSlotRegistrar {
  return {
    registerToolBlock: (entry) => scope.registerChain('chat.toolBlock' as never, entry as never),
    registerActivityPanel: (panelKey, entry) =>
      scope.registerKeyed('activity.panel' as never, panelKey as never, entry as never),
    registerHeaderAction: (entry) =>
      scope.registerList('session.header.actions' as never, entry as never),
    registerSessionProvider: (entry) =>
      scope.registerHoc('session.providers' as never, entry as never),
    registerComposerToolbarRight: (entry) =>
      scope.registerList('chat.composer.toolbar.right' as never, entry as never),
    registerComposerToolbarLeft: (entry) =>
      scope.registerList('chat.composer.toolbar.left' as never, entry as never),
    registerMarkdownFence: (entry) =>
      scope.registerChain('chat.markdown.fence' as never, entry as never),
    registerMessageRow: (entry) =>
      scope.registerHoc('chat.message.row' as never, entry as never),
    registerAssistantAction: (entry) =>
      scope.registerList('chat.message.assistant.actions' as never, entry as never),
    registerStatusBarItem: (side, entry) =>
      scope.registerList((side === 'left' ? 'chat.statusBar.left' : 'chat.statusBar.right') as never, entry as never),
    registerSidebarTab: (entry) => scope.registerList('sidebar.tabs' as never, entry as never),
    registerSidebarDrawer: (entry) => scope.registerList('sidebar.drawer' as never, entry as never),
    registerSidebarFooterAction: (entry) =>
      scope.registerList('sidebar.footer.actions' as never, entry as never),
    registerSidebarSessionRowTrailing: (entry) =>
      scope.registerList('sidebar.session.row.trailing' as never, entry as never),
    registerSingle: (slot, entry) => scope.registerSingle(slot as never, entry as never),
    registerList: (slot, entry) => scope.registerList(slot as never, entry as never),
    registerKeyed: (slot, key, entry) => scope.registerKeyed(slot as never, key as never, entry as never),
    registerChain: (slot, entry) => scope.registerChain(slot as never, entry as never),
    registerHoc: (slot, entry) => scope.registerHoc(slot as never, entry as never),
  }
}

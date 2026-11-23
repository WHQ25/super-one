import type { ComponentType, ReactNode } from 'react'
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
  registerSingle(slot: string, entry: SingleSlotEntry<any, any>): SlotDisposer
  registerList(slot: string, entry: ListSlotEntry<any, any>): SlotDisposer
  registerKeyed(slot: string, key: string, entry: KeyedSlotEntry<any, any>): SlotDisposer
  registerChain(slot: string, entry: ChainSlotEntry<any, any>): SlotDisposer
  registerHoc(slot: string, entry: HocSlotEntry<any, any>): SlotDisposer
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

export function setPluginSdkHostAdapter(adapter: PluginSdkHostAdapter | null): void {
  activeHostAdapter = adapter
}

export function usePluginSession(): PluginSessionSnapshot {
  return activeHostAdapter ? activeHostAdapter.useSession() : DEFAULT_SESSION_SNAPSHOT
}

export function usePluginTheme(): PluginThemeSnapshot {
  return activeHostAdapter ? activeHostAdapter.useTheme() : DEFAULT_THEME_SNAPSHOT
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
    registerSingle: (slot, entry) => scope.registerSingle(slot as never, entry as never),
    registerList: (slot, entry) => scope.registerList(slot as never, entry as never),
    registerKeyed: (slot, key, entry) => scope.registerKeyed(slot as never, key as never, entry as never),
    registerChain: (slot, entry) => scope.registerChain(slot as never, entry as never),
    registerHoc: (slot, entry) => scope.registerHoc(slot as never, entry as never),
  }
}

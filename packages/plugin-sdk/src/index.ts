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
import type { DshPluginRpcResult } from '@superone/shared/dsh-plugin-client'

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

export interface PluginActivityPanelApi {
  openPanel(panelKey: string, title: string, params?: Record<string, unknown>): void
  closePanel(panelKey: string): void
}

export interface PluginRpcClient {
  invoke<T = unknown>(method: string, payload?: unknown): Promise<DshPluginRpcResult<T>>
  on(event: string, callback: (payload: unknown) => void): () => void
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
    registerSingle: (slot, entry) => scope.registerSingle(slot as never, entry as never),
    registerList: (slot, entry) => scope.registerList(slot as never, entry as never),
    registerKeyed: (slot, key, entry) => scope.registerKeyed(slot as never, key as never, entry as never),
    registerChain: (slot, entry) => scope.registerChain(slot as never, entry as never),
    registerHoc: (slot, entry) => scope.registerHoc(slot as never, entry as never),
  }
}

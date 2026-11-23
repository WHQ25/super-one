import type { ComponentType } from 'react'
import type { SlotDisposer, SlotRegistry, SlotScopeHandle } from '@superone/ui-slots'

export type KernelDisposer = SlotDisposer

export interface CommandInvocation {
  id: string
  args: readonly unknown[]
}

export type CommandHandler<Args extends readonly unknown[] = readonly unknown[], Result = unknown> = (
  ...args: Args
) => Result | Promise<Result>

export type CommandMiddleware = (
  invocation: CommandInvocation,
  next: () => Promise<unknown>,
) => Promise<unknown>

export interface CommandDefinition {
  id: string
  title?: string
  category?: string
  priority?: number
  handler: CommandHandler<any, any>
}

export interface RegisteredCommandMeta {
  id: string
  title?: string
  category?: string
  priority: number
}

export type KeybindingFocusArea = 'xterm' | 'input' | 'editor' | 'activity' | 'chat' | 'global'

export interface KeybindingContext {
  view?: string
  sessionId?: string
  projectPath?: string | null
  provider?: string
  supportsUiPlugins: boolean
  inTerminal: boolean
  inInput: boolean
  inActivity: boolean
  focusArea: KeybindingFocusArea
  hasPendingPlanApproval?: boolean
  data?: Record<string, unknown>
}

export type KeybindingPredicate = (ctx: KeybindingContext) => boolean

export interface KeybindingDefinition {
  id?: string
  key: string
  command?: string
  args?: readonly unknown[]
  handler?: (ctx: KeybindingContext, event: KeyboardEvent | null) => boolean | void | Promise<boolean | void>
  when?: KeybindingPredicate
  priority?: number
  allowInTerminal?: boolean
  capture?: boolean
  preventDefault?: boolean
}

export interface KeybindingContextResolver {
  (event: KeyboardEvent | null): KeybindingContext
}

export type MenuId =
  | 'session.contextMenu'
  | 'session.headerMenu'
  | 'composer.plusMenu'
  | 'activity.launcher'
  | (string & {})

export interface MenuContext {
  menuId: string
  sessionId?: string | null
  projectPath?: string | null
  provider?: string | null
  supportsUiPlugins?: boolean
  hasFolder?: boolean
  target?: unknown
  extra?: Record<string, unknown>
}

export interface MenuItemDefinition {
  id: string
  label: string | ((ctx: MenuContext) => string)
  icon?: ComponentType<{ className?: string }>
  group?: string
  order?: number
  shortcut?: string
  destructive?: boolean
  disabled?: boolean | ((ctx: MenuContext) => boolean)
  when?: (ctx: MenuContext) => boolean
  command?: string
  commandArgs?: readonly unknown[] | ((ctx: MenuContext) => readonly unknown[])
  onSelect?: (ctx: MenuContext) => void | Promise<void>
  submenu?: MenuItemDefinition[]
}

export interface ResolvedMenuItem {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
  group?: string
  order: number
  shortcut?: string
  destructive: boolean
  disabled: boolean
  onSelect: () => void
  submenu?: ResolvedMenuItem[]
}

export type LayoutActionErrorCode = 'unsupported' | 'unavailable' | 'not_found' | 'error'

export type LayoutActionResult<T = unknown> =
  | { ok: true; data?: T }
  | { ok: false; unsupported?: boolean; code: LayoutActionErrorCode; message: string }

export interface LayoutOpenPanelRequest {
  id?: string
  panelKey: string
  title: string
  component?: string
  params?: Record<string, unknown>
  reveal?: boolean
  focus?: boolean
}

export interface LayoutAdapter {
  openPanel?: (request: LayoutOpenPanelRequest) => LayoutActionResult | Promise<LayoutActionResult>
  closePanel?: (panelIdOrKey: string) => LayoutActionResult | Promise<LayoutActionResult>
  focusPanel?: (panelIdOrKey: string) => LayoutActionResult | Promise<LayoutActionResult>
  toggleSidebar?: (open?: boolean) => LayoutActionResult | Promise<LayoutActionResult>
  toggleActivityPanel?: (open?: boolean) => LayoutActionResult | Promise<LayoutActionResult>
  focusSession?: (projectPath: string, sessionId: string) => LayoutActionResult | Promise<LayoutActionResult>
  splitSession?: (projectPath: string, sessionId: string, edge?: 'left' | 'right' | 'top' | 'bottom') => LayoutActionResult | Promise<LayoutActionResult>
  setChatMode?: (mode: 'docked' | 'floating' | 'icon') => LayoutActionResult | Promise<LayoutActionResult>
  getSnapshot?: () => unknown
}

export interface ThemeScope {
  projectPath?: string
  sessionId?: string
  harness?: string
}

export interface LchPartial {
  l?: number
  c?: number
  h?: number
  a?: number
}

export interface ThemeLayerDefinition {
  id?: string
  priority?: number
  scope?: ThemeScope
  brandHue?: number | null
  lightTokens?: Record<string, LchPartial>
  darkTokens?: Record<string, LchPartial>
  cssVars?: Record<string, string>
}

export interface ResolvedThemeOverrides {
  brandHue?: number | null
  lightTokens: Record<string, LchPartial>
  darkTokens: Record<string, LchPartial>
  cssVars: Record<string, string>
}

export interface CommandsBus {
  registerCommand(definition: CommandDefinition): KernelDisposer
  registerMiddleware(commandId: string | '*', middleware: CommandMiddleware, priority?: number): KernelDisposer
  executeCommand<Result = unknown>(id: string, ...args: unknown[]): Promise<Result>
  hasCommand(id: string): boolean
  listCommands(): readonly RegisteredCommandMeta[]
  subscribe(listener: () => void): () => void
}

export interface KeybindingsBus {
  registerKeybinding(definition: KeybindingDefinition): KernelDisposer
  handleKeyEvent(event: KeyboardEvent, resolveContext: KeybindingContextResolver, options?: { capture?: boolean }): boolean
  dispatchShortcut(commandIdOrSpec: string, ctx: KeybindingContext): boolean
  listKeybindings(): readonly KeybindingDefinition[]
  subscribe(listener: () => void): () => void
}

export interface MenusBus {
  registerMenuItem(menuId: MenuId, item: MenuItemDefinition): KernelDisposer
  getMenuItems(menuId: MenuId, ctx: MenuContext): readonly ResolvedMenuItem[]
  getVersion(menuId?: MenuId): number
  subscribe(listener: () => void): () => void
  subscribeMenu(menuId: MenuId, listener: () => void): () => void
}

export interface LayoutBus {
  setAdapter(adapter: LayoutAdapter): KernelDisposer
  openPanel(request: LayoutOpenPanelRequest): Promise<LayoutActionResult>
  closePanel(panelIdOrKey: string): Promise<LayoutActionResult>
  focusPanel(panelIdOrKey: string): Promise<LayoutActionResult>
  toggleSidebar(open?: boolean): Promise<LayoutActionResult>
  toggleActivityPanel(open?: boolean): Promise<LayoutActionResult>
  focusSession(projectPath: string, sessionId: string): Promise<LayoutActionResult>
  splitSession(projectPath: string, sessionId: string, edge?: 'left' | 'right' | 'top' | 'bottom'): Promise<LayoutActionResult>
  setChatMode(mode: 'docked' | 'floating' | 'icon'): Promise<LayoutActionResult>
  getSnapshot(): unknown
}

export interface ThemeBus {
  registerLayer(layer: ThemeLayerDefinition): KernelDisposer
  getOverrides(scope?: ThemeScope): ResolvedThemeOverrides
  getVersion(scope?: ThemeScope): number
  subscribe(listener: () => void): () => void
}

export interface KernelScope {
  readonly disposed: boolean
  readonly slots: SlotScopeHandle
  registerCommand(definition: CommandDefinition): KernelDisposer
  registerCommandMiddleware(commandId: string | '*', middleware: CommandMiddleware, priority?: number): KernelDisposer
  registerKeybinding(definition: KeybindingDefinition): KernelDisposer
  registerMenuItem(menuId: MenuId, item: MenuItemDefinition): KernelDisposer
  registerThemeLayer(layer: ThemeLayerDefinition): KernelDisposer
  createChildScope(): KernelScope
  onDispose(fn: () => void): KernelDisposer
  dispose(): void
  [Symbol.dispose](): void
}

export interface ClientKernel {
  readonly slots: SlotRegistry
  readonly commands: CommandsBus
  readonly keybindings: KeybindingsBus
  readonly menus: MenusBus
  readonly layout: LayoutBus
  readonly theme: ThemeBus
  createScope(): KernelScope
  dispose(): void
}

/**
 * Claude Code mods drawn by SuperOne: the host-neutral contract between the
 * harness adapter (`@superone/claude/mod-surface`), the environment gateway and
 * every view that draws a mod (desktop renderer, phone chat view).
 *
 * The CLI speaks an internal remote-surface protocol (`ui_attach`, `ui_render`,
 * …); only the adapter knows its wire spelling. These types mirror it in
 * camelCase. Element trees are passed through as the CLI validated them: their
 * props are the plugin-facing names (`flexDirection`, `dimColor`), already
 * bounded by the engine. Every string in a tree is plain text: draw it as a
 * text node, never as markup.
 */

import type { AgentEvent } from './agent-types'

/** Surfaces the CLI lets a remote client attach as. A closed set upstream. */
export type ModSurface = 'desktop' | 'mobile' | 'vscode'

/** Render sites a `ui.render` hook can draw at. */
export const MOD_RENDER_COMPONENTS = [
  'AskUserQuestion',
  'UserMessage',
  'AssistantMessage',
  'ToolUse',
  'ToolResult',
  'ToolGroup',
  'ToolProgress',
  'CommandOutput',
  'Spinner',
  'TurnDuration',
  'InfoNotice',
  'SessionMode',
  'PromptHint',
  'AbovePrompt',
  'Pane',
] as const
export type ModRenderComponent = (typeof MOD_RENDER_COMPONENTS)[number]

/** Sites each remote surface draws (the CLI raises the rest on the terminal only). */
export const MOD_SITES_BY_SURFACE: Record<ModSurface, readonly ModRenderComponent[]> = {
  desktop: ['AskUserQuestion', 'UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'Spinner', 'SessionMode', 'PromptHint', 'AbovePrompt', 'Pane'],
  mobile: ['AskUserQuestion', 'UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'Pane'],
  vscode: ['AskUserQuestion', 'UserMessage', 'AssistantMessage', 'ToolUse', 'ToolResult', 'ToolGroup', 'CommandOutput', 'Pane'],
}

/** Instance id the CLI uses for the band. */
export const MOD_ABOVE_PROMPT_INSTANCE = 'above-prompt'
/** Instance id the CLI uses for the session-mode chip. */
export const MOD_SESSION_MODE_INSTANCE = 'session-mode'
/** Instance id the terminal uses for the hint line; remote surfaces reuse it. */
export const MOD_PROMPT_HINT_INSTANCE = 'prompt-hint'

/** The size a surface draws into, in character cells of its code font. */
export interface ModViewport {
  columns: number
  rows: number
  /** Whether the surface docks a pane beside the transcript. Absent = unknown. */
  isFullscreen?: boolean
}

export type ModPrimitive = string | number | boolean

/** Where a pressable element's closure lives in the plugin's environment. */
export interface ModPressRef {
  plugin: string
  handle: number
}

/** One node of a validated element tree. */
/** A layout or text node: `Box` / `Text` (and `div` / `span` / `b` the CLI may relay). */
export interface ModStyledElement {
  type: 'Box' | 'Text' | 'div' | 'span' | 'b'
  props?: Record<string, ModPrimitive>
  hover?: Record<string, ModPrimitive>
  group?: { plugin: string }
  children?: ModChild[]
}

export type ModElement =
  | ModStyledElement
  | { type: 'Button'; props: ModButtonProps; press: ModPressRef; hover?: Record<string, ModPrimitive> }
  | { type: 'Input'; props: ModInputProps; press: ModPressRef }
  | { type: 'Select'; props: ModSelectProps; press: ModPressRef }
  | { type: 'Link'; props: { href: string; label?: string }; children?: ModChild[] }
  | { type: 'Code'; props: ModCodeProps }
  | { type: 'Markdown'; props: { key?: string; text: string; dimColor?: boolean; pressableLinks?: string[] }; press?: ModPressRef }
  | { type: 'Svg'; props: { source: string; alt: string; width?: number; height?: number; isInteractive?: boolean } }
  | { type: 'Client'; props: ModClientProps; client: { plugin: string } }
  /** SuperOne's own drawing of the site: `ref 0` the request's props, else the response props. */
  | { type: 'engine'; ref: number }

export type ModChild = string | ModElement

export interface ModButtonProps {
  key: string
  label: string
  hotkey?: string
  action?: string
  plain?: true
  dimColor?: boolean
  variant?: 'primary' | 'secondary'
  role?: 'dismiss'
  autoFocus?: true
}

export interface ModInputProps {
  key: string
  label?: string
  placeholder?: string
  value?: string
  submitLabel?: string
  autoFocus?: true
}

export interface ModSelectProps {
  key: string
  label?: string
  options: Array<{ value: string; label?: string }>
  value?: string
  autoFocus?: true
}

export interface ModCodeProps {
  source: string
  language?: string
  path?: string
  startLine?: number
  format?: 'source' | 'diff'
  wrap?: 'wrap' | 'truncate-end'
}

export interface ModClientProps {
  key: string
  /** The surface module's path under the plugin folder (`hooks/board.tsx`). */
  module: string
  props?: unknown
  width?: number | string
  height?: number | string
  flexGrow?: number
}

/** Where a keyed element of a Pane or band sits, in content rows. */
export interface ModKeyedRow {
  plugin: string
  key: string
  top: number
  bottom: number
}

export interface ModOnScreen {
  first: number
  last: number
  of: number
}

export interface ModRenderRequest {
  surface: ModSurface
  clientId: string
  component: ModRenderComponent
  instanceId: string
  props: Record<string, unknown>
  viewport?: ModViewport
  onScreen?: ModOnScreen | null
  contentRows?: number
  keyed?: ModKeyedRow[]
}

export interface ModRenderResult {
  tree: ModElement
  /** Props to draw the first non-zero engine ref with; later refs use the request's props. */
  props: Record<string, unknown>
  /** True when a plugin hooks this component. False: stop asking until the next un-narrowed invalidate. */
  hooked: boolean
  /** Per plugin, the hash of its `Client` surface modules carried by this tree. */
  clientModules?: Record<string, string>
}

/** One placed pane, as the CLI holds it. */
export interface ModPane {
  id: string
  title: string
  plugin: string
  closeOnEscape?: true
  holdToasts?: true
  rows?: number
  columns?: number
}

export interface ModPaneRoster {
  panes: ModPane[]
  shownId: string | null
  focusedId: string | null
  focusRequestedId: string | null
}

export const EMPTY_MOD_PANE_ROSTER: ModPaneRoster = { panes: [], shownId: null, focusedId: null, focusRequestedId: null }

export interface ModInstanceRef {
  surface: ModSurface | 'terminal'
  component: ModRenderComponent
  instanceId: string
}

export type ModScrollComponent = 'Pane' | 'AbovePrompt'

/** A plugin's prompt decoration run, colors already resolved by the CLI. */
export interface ModDecoration {
  start: number
  end: number
  color?: string
  backgroundColor?: string
  dimColor?: boolean
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
}

/** CLI → client requests a client answers on a plugin's behalf. */
export type ModHostRequest =
  | { kind: 'copy'; plugin: string; text: string }
  | { kind: 'promptRead' }
  | { kind: 'promptFill'; text: string; mode: 'replace' | 'append' | 'insert'; decorations?: ModDecoration[] }
  | { kind: 'promptSuggest'; text: string }

export type ModHostReply =
  | { kind: 'copy'; copied: boolean }
  | { kind: 'promptRead'; text: string; cursor: number }
  | { kind: 'promptFill'; filled: boolean }
  | { kind: 'promptSuggest'; shown: boolean }

export type ModHostRequestKind = ModHostRequest['kind']

export interface ModClientModuleBundle {
  plugin: string
  hash: string
  modules: Array<{ module: string; entry: string; component: string }>
  runtime: string
  limits: { nodes: number; depth: number; chars: number; values: number; dataDepth: number }
  files: Array<{ key: string; source: string }>
}

/** Where a `Client` instance sits: the tree that drew it and its node. */
export interface ModClientLocation {
  plugin: string
  component: ModRenderComponent
  instanceId: string
  /** The Client node's key. */
  client: string
  module: string
}

/**
 * Every operation a view can ask of a session's mod surface, keyed by op.
 * `request` is what the view sends, `result` what it gets back.
 */
export interface ModUiOps {
  attach: {
    request: { surface: ModSurface; clientId: string; viewport?: ModViewport; answers?: ModHostRequestKind[] }
    result: { surfaces: string[] }
  }
  detach: { request: { clientId: string }; result: { detached: boolean } }
  render: { request: ModRenderRequest; result: ModRenderResult }
  press: {
    request: { plugin: string; handle: number; key?: string; href?: string; surface: ModSurface; clientId: string }
    result: { handled: boolean }
  }
  input: {
    request: { plugin: string; handle: number; kind: 'change' | 'submit'; value: string; key: string; component: ModRenderComponent; instanceId: string; surface: ModSurface; clientId: string }
    result: { handled: boolean; value?: string }
  }
  select: {
    request: { plugin: string; handle: number; value: string; key: string; component: ModRenderComponent; instanceId: string; surface: ModSurface; clientId: string }
    result: { handled: boolean }
  }
  panes: { request: { clientId: string }; result: ModPaneRoster }
  paneShow: { request: { id: string; surface: ModSurface; clientId: string }; result: { shownId: string | null } }
  paneFocus: { request: { id: string | null; surface: ModSurface; clientId: string }; result: { focusedId: string | null } }
  close: { request: { id: string; clientId: string }; result: { closed: boolean } }
  scroll: {
    request: { component: ModScrollComponent; instanceId: string; offset: number; by: number; bodyRows: number; contentRows: number; keyed?: ModKeyedRow[]; surface: ModSurface; clientId: string }
    result: { moved: boolean; offset: number; followEnd?: boolean }
  }
  focus: {
    request: { component: ModScrollComponent; instanceId: string; isHeld: boolean; element?: { plugin: string; key: string } | null; by?: 'person' | 'auto'; surface: ModSurface; clientId: string }
    result: { moved: boolean; element: { plugin: string; key: string } | null }
  }
  clientModule: { request: { plugin: string }; result: ModClientModuleBundle }
  clientPress: {
    request: ModClientLocation & { element: string; event: { type: 'press' } | { type: 'input'; kind: 'change' | 'submit'; value: string } | { type: 'select'; value: string } }
    result: { handled: boolean; reached?: Record<string, unknown> }
  }
  message: { request: ModClientLocation & { data: unknown }; result: { handled: boolean; props?: unknown } }
  promptEdit: {
    request: { text: string; cursor: number; key?: { key: string; ctrl?: true; shift?: true; meta?: true }; by?: 'person' | 'app'; surface: ModSurface; clientId: string }
    result: { text: string; cursor: number; decorations?: ModDecoration[]; superseded?: true }
  }
  /** Answers a `mod_host_request` the CLI sent to this client; only that client's answer is taken. */
  hostReply: { request: { requestId: string; clientId: string; reply: ModHostReply }; result: { accepted: boolean } }
}

export type ModUiOp = keyof ModUiOps
export type ModUiRequest<O extends ModUiOp = ModUiOp> = ModUiOps[O]['request']
export type ModUiResult<O extends ModUiOp = ModUiOp> = ModUiOps[O]['result']

/** Ops that change what a plugin sees or does; a remote node gates them on the control lease. */
export const MOD_UI_MUTATING_OPS: ReadonlySet<ModUiOp> = new Set<ModUiOp>([
  'press', 'input', 'select', 'paneShow', 'paneFocus', 'close', 'scroll', 'focus', 'clientPress', 'message', 'promptEdit',
])

// The CLI refuses a `ui_attach` whose client id is not 1-64 of letters, digits,
// `.`, `_` or `-` (docs/harness/claude/contracts.md), so derived ids join their
// parts with `-` / `.`.

/** The client id a phone attaches as: one per device, so its scroll and focus stay its own. */
export function mobileModClientId(deviceId: string): string {
  return `mobile-${deviceId}`
}

/** A phone's request as the desktop forwards it: the phone may only speak as itself. */
export function asDeviceModUiRequest<O extends ModUiOp>(request: ModUiRequest<O>, deviceId: string): ModUiRequest<O> {
  const stamped: Record<string, unknown> = { ...request }
  if ('clientId' in stamped) stamped.clientId = mobileModClientId(deviceId)
  if ('surface' in stamped) stamped.surface = 'mobile'
  return stamped as ModUiRequest<O>
}

/**
 * The client id a node gives a view of one paired client: the view's own id
 * scoped to the caller's pairing, so a caller only ever speaks as itself and
 * two desktops on one node stay apart.
 */
export function nodeModClientId(clientId: string, clientSessionId: string): string {
  return `${clientId}.${clientSessionId}`
}

/** A view's request as a node runs it, under the RPC caller's own pairing. */
export function asNodeCallerModUiRequest<O extends ModUiOp>(request: ModUiRequest<O>, clientSessionId: string): ModUiRequest<O> {
  if (!('clientId' in request)) return request
  return { ...request, clientId: nodeModClientId(String(request.clientId), clientSessionId) }
}

/**
 * A node's mod event as one paired client reads it: ids scoped to that
 * client's pairing read as the view's own id; other clients' ids stay scoped,
 * so they never match a view of this client.
 */
export function asNodeReaderModEvent(event: AgentEvent, clientSessionId: string): AgentEvent {
  if (!('clientId' in event) || !event.type.startsWith('mod_')) return event
  const suffix = nodeModClientId('', clientSessionId)
  return event.clientId.endsWith(suffix) ? { ...event, clientId: event.clientId.slice(0, -suffix.length) } : event
}

/** Thrown (by name) when a session cannot draw mods right now. */
export const MOD_UI_UNAVAILABLE = 'mod-ui-unavailable'

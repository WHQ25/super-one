import type { AgentEvent } from '@superone/shared/agent-types'
import type {
  ModHostReply,
  ModHostRequest,
  ModHostRequestKind,
  ModInstanceRef,
  ModPane,
  ModPaneRoster,
  ModUiOp,
} from '@superone/shared/mod-ui'

/**
 * Wire spelling of the Claude Code remote-surface protocol (CLI 2.1.287).
 *
 * The CLI marks every one of these messages `@internal`; none is in `sdk.d.ts`.
 * Shapes were read from the native binary's schemas and verified live; the
 * contracts are recorded in docs/harness/claude/contracts.md § "Mod UI rides a
 * private control protocol".
 */

/** Control-request subtype for each host → CLI op. `hostReply` never reaches the CLI. */
export const OP_SUBTYPE: Record<Exclude<ModUiOp, 'hostReply'>, string> = {
  attach: 'ui_attach',
  detach: 'ui_detach',
  render: 'ui_render',
  press: 'ui_press',
  input: 'ui_input',
  select: 'ui_select',
  panes: 'ui_panes',
  paneShow: 'ui_pane_show',
  paneFocus: 'ui_pane_focus',
  close: 'ui_close',
  scroll: 'ui_scroll',
  focus: 'ui_focus',
  clientModule: 'ui_client_module',
  clientPress: 'ui_client_press',
  message: 'ui_message',
  promptEdit: 'ui_prompt_edit',
}

/** The `ui_attach.answers` entry for each CLI → host request a client answers. */
export const HOST_REQUEST_SUBTYPE: Record<ModHostRequestKind, string> = {
  copy: 'ui_copy',
  promptRead: 'ui_prompt_read',
  promptFill: 'ui_prompt_fill',
  promptSuggest: 'ui_prompt_suggest',
}

/**
 * Top-level request/response keys whose wire spelling differs. Nested values
 * (`props`, `tree`, `viewport`, `keyed`, `data`, `reached`, `element`) are
 * already in the plugin-facing spelling and pass through untouched.
 */
const WIRE_KEY: Record<string, string> = {
  clientId: 'client_id',
  instanceId: 'instance_id',
  onScreen: 'on_screen',
  contentRows: 'content_rows',
  bodyRows: 'body_rows',
  isHeld: 'is_held',
}
const LOCAL_KEY: Record<string, string> = {
  shown_id: 'shownId',
  focused_id: 'focusedId',
  focus_requested_id: 'focusRequestedId',
  follow_end: 'followEnd',
  client_modules: 'clientModules',
  close_on_escape: 'closeOnEscape',
  hold_toasts: 'holdToasts',
}

function renameKeys(obj: Record<string, unknown>, names: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue
    out[names[key] ?? key] = value
  }
  return out
}

/** The control request body for one op. */
export function toWireRequest(op: Exclude<ModUiOp, 'hostReply'>, request: Record<string, unknown>): Record<string, unknown> {
  const body = renameKeys(request, WIRE_KEY)
  if (op === 'attach' && Array.isArray(request.answers)) {
    body.answers = (request.answers as ModHostRequestKind[]).map((kind) => HOST_REQUEST_SUBTYPE[kind])
  }
  return { subtype: OP_SUBTYPE[op], ...body }
}

/** The op's result from a control response payload. */
export function fromWireResponse(op: Exclude<ModUiOp, 'hostReply'>, response: unknown): unknown {
  if (!response || typeof response !== 'object') return response
  const raw = response as Record<string, unknown>
  if (op === 'panes') return toRoster(raw)
  const out = renameKeys(raw, LOCAL_KEY)
  delete out.bench
  delete out.rewritten
  return out
}

function toPane(raw: unknown): ModPane | null {
  if (!raw || typeof raw !== 'object') return null
  const pane = renameKeys(raw as Record<string, unknown>, LOCAL_KEY) as unknown as ModPane
  return typeof pane.id === 'string' && typeof pane.plugin === 'string' ? { ...pane, title: typeof pane.title === 'string' ? pane.title : pane.id } : null
}

function toRoster(raw: Record<string, unknown>): ModPaneRoster {
  const panes = Array.isArray(raw.panes) ? raw.panes.map(toPane).filter((p): p is ModPane => p !== null) : []
  const id = (value: unknown) => (typeof value === 'string' ? value : null)
  return { panes, shownId: id(raw.shown_id), focusedId: id(raw.focused_id), focusRequestedId: id(raw.focus_requested_id) }
}

/**
 * A mod push the CLI streamed as a `system` frame, as the AgentEvent views
 * consume. Null for anything else (including `ui_log` / `ui_toast` /
 * `ui_status`, which `plugin-notice-wire` maps).
 */
export function mapModSystemMessage(sys: Record<string, unknown>): AgentEvent | null {
  switch (sys.subtype) {
    case 'ui_invalidate': {
      if (!Array.isArray(sys.instances)) return { type: 'mod_invalidate' }
      const instances = sys.instances
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object' && typeof (i as { instance_id?: unknown }).instance_id === 'string')
        .map((i) => ({ surface: i.surface, component: i.component, instanceId: i.instance_id }) as ModInstanceRef)
      return { type: 'mod_invalidate', instances }
    }
    case 'ui_panes':
      return { type: 'mod_panes', roster: toRoster(sys) }
    case 'ui_scroll':
      if (typeof sys.client_id !== 'string' || typeof sys.instance_id !== 'string' || typeof sys.offset !== 'number') return null
      return {
        type: 'mod_scroll',
        clientId: sys.client_id,
        component: sys.component === 'AbovePrompt' ? 'AbovePrompt' : 'Pane',
        instanceId: sys.instance_id,
        offset: sys.offset,
        ...(sys.follow_end === true ? { followEnd: true } : {}),
      }
    case 'ui_focus':
      if (typeof sys.client_id !== 'string' || typeof sys.instance_id !== 'string' || typeof sys.plugin !== 'string' || typeof sys.key !== 'string') return null
      return {
        type: 'mod_focus',
        clientId: sys.client_id,
        component: sys.component === 'AbovePrompt' ? 'AbovePrompt' : 'Pane',
        instanceId: sys.instance_id,
        plugin: sys.plugin,
        key: sys.key,
      }
    default:
      return null
  }
}

/** A CLI → host request (`setUiHost` handler argument) as a host-neutral request. */
export function toHostRequest(kind: ModHostRequestKind, req: Record<string, unknown>): ModHostRequest {
  switch (kind) {
    case 'copy':
      return { kind, plugin: String(req.plugin ?? ''), text: String(req.text ?? '') }
    case 'promptRead':
      return { kind }
    case 'promptFill': {
      const mode = req.mode === 'append' || req.mode === 'insert' ? req.mode : 'replace'
      return {
        kind,
        text: String(req.text ?? ''),
        mode,
        ...(Array.isArray(req.decorations) ? { decorations: req.decorations as Extract<ModHostRequest, { kind: 'promptFill' }>['decorations'] } : {}),
      }
    }
    case 'promptSuggest':
      return { kind, text: String(req.text ?? '') }
  }
}

/** The answer the CLI expects, from a client's reply (or the safe default). */
export function toWireHostReply(kind: ModHostRequestKind, reply: ModHostReply | null): Record<string, unknown> {
  switch (kind) {
    case 'copy':
      return { copied: reply?.kind === 'copy' && reply.copied }
    case 'promptRead':
      return reply?.kind === 'promptRead' ? { text: reply.text, cursor: reply.cursor } : { text: '', cursor: 0 }
    case 'promptFill':
      return { filled: reply?.kind === 'promptFill' && reply.filled }
    case 'promptSuggest':
      return { shown: reply?.kind === 'promptSuggest' && reply.shown }
  }
}

import type { ModChild, ModClientModuleBundle, ModElement } from '@superone/shared/mod-ui'
import { isDrawableModTree } from './validate'

/**
 * A `Client` element runs plugin code. SuperOne runs it the way the CLI's
 * surface runtime expects (`install(host, limits)`, then `stage` + `run`), in
 * an opaque sandboxed frame with no network, and draws the tree it returns
 * with the same renderer as every other mod tree.
 */

export type ClientLimits = ModClientModuleBundle['limits']

/** Frame → host. */
export type FrameMessage =
  | { t: 'tree'; text: string; pointer: boolean; key: boolean }
  | { t: 'post'; text: string }
  | { t: 'timer'; op: 'start'; timer: number; ms: number }
  | { t: 'timer'; op: 'stop'; timer: number }
  | { t: 'fault'; message: string }

/** Host → frame. */
export type HostMessage =
  | { t: 'setProps'; props: unknown }
  | { t: 'resize'; columns: number; rows: number }
  | { t: 'pointer'; event: ClientPointerEvent }
  | { t: 'key'; event: ClientKeyEvent }
  | { t: 'tick'; timer: number }
  | { t: 'held'; handle: number; event: unknown }
  | { t: 'dropHeld'; handles: number[] }

export interface ClientPointerEvent {
  type: 'down' | 'up' | 'move' | 'enter' | 'leave'
  x: number
  y: number
  button?: 'left' | 'middle' | 'right'
  shift?: true
  alt?: true
  ctrl?: true
}

export interface ClientKeyEvent {
  key: string
  ctrl?: true
  shift?: true
  meta?: true
}

/** The CLI's floor for `surface.every`: one terminal frame. */
export const CLIENT_TIMER_FLOOR_MS = 16

export interface ClientFrameConfig {
  bundle: ModClientModuleBundle
  module: string
  props: unknown
  columns: number
  rows: number
}

/**
 * Runs in the frame. Turns the bundle's files into blob modules (an import
 * map lets them import one another by the CLI's keys), installs the runtime
 * and mounts the module's component as instance 1. A string, not a function:
 * bundlers rewrite `import()` in code they compile, and this never is.
 */
const BOOTSTRAP = `(() => {
  const cfgEl = document.getElementById('cfg')
  const cfg = JSON.parse(cfgEl.textContent)
  cfgEl.remove()
  const host = parent
  const send = (m) => host.postMessage(m, '*')
  const fault = (err) => send({ t: 'fault', message: err instanceof Error ? err.message : String(err) })
  const urls = {}
  for (const f of cfg.bundle.files) urls[f.key] = URL.createObjectURL(new Blob([f.source], { type: 'text/javascript' }))
  const map = document.createElement('script')
  map.type = 'importmap'
  map.nonce = cfg.nonce
  map.textContent = JSON.stringify({ imports: urls })
  document.head.append(map)
  const entry = cfg.bundle.modules.find((m) => m.module === cfg.module)
  if (!entry) return fault('the plugin loaded no surface module at ' + cfg.module)
  let api = null
  let timers = 0
  let scheduled = false
  const run = (kind, payload) => {
    api.stage(1, kind, payload)
    return globalThis.__surface__.run()
  }
  const render = () => {
    scheduled = false
    try {
      const text = run('render')
      send({ t: 'tree', text, pointer: api.hasListener(1, 'pointer'), key: api.hasListener(1, 'key') })
    } catch (err) {
      fault(err)
    }
  }
  const schedule = () => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(render)
  }
  // What the host sends while the modules load is applied once the component is mounted.
  const early = []
  addEventListener('message', (e) => {
    if (e.source !== host) return
    if (api) receive(e.data)
    else early.push(e.data)
  })
  const receive = (m) => {
    try {
      switch (m.t) {
        case 'setProps': api.setProps(1, m.props); return schedule()
        case 'resize': api.resize(1, m.columns, m.rows); return schedule()
        case 'pointer': case 'key': run(m.t, m.event); return
        case 'tick': run('tick', m.timer); return
        case 'held': run('held', { handle: m.handle, event: m.event }); return
        case 'dropHeld': api.dropHeld(1, m.handles)
      }
    } catch (err) {
      fault(err)
    }
  }
  ;(async () => {
    const runtime = await import(urls[cfg.bundle.runtime])
    globalThis.h = runtime.h
    globalThis.Fragment = runtime.Fragment
    const installed = runtime.install({
      schedule,
      startTimer: (_id, ms) => {
        const timer = ++timers
        send({ t: 'timer', op: 'start', timer, ms })
        return timer
      },
      stopTimer: (_id, timer) => send({ t: 'timer', op: 'stop', timer }),
      post: (_id, text) => send({ t: 'post', text }),
    }, cfg.bundle.limits)
    const mod = await import(urls[entry.entry])
    installed.mount(1, mod[entry.component], cfg.props)
    installed.resize(1, cfg.columns, cfg.rows)
    api = installed
    for (const m of early.splice(0)) receive(m)
    schedule()
  })().catch(fault)
})()`

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** The frame's whole document: a nonce-only CSP, the bundle as inert JSON, and the bootstrap. */
export function clientFrameDocument(config: ClientFrameConfig, nonce = randomNonce()): string {
  // `<` escaped: no source text can close the data block.
  const data = JSON.stringify({ ...config, nonce }).replace(/</g, '\\u003c')
  return [
    '<!doctype html><html><head>',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' blob:">`,
    `<script type="application/json" id="cfg">${data}</script>`,
    `<script nonce="${nonce}">${BOOTSTRAP}</script>`,
    '</head><body></body></html>',
  ].join('')
}

const CLIENT_TYPES = new Set(['Box', 'Text', 'Button', 'Input', 'Select', 'Link', 'Code', 'Markdown'])
const PRESSABLE = new Set(['Button', 'Input', 'Select'])

export type ImportedClientTree = { tree: ModElement; handles: number[] } | { fault: string }

/**
 * Reads the tree text a frame sent, never trusting it: the CLI's limits, its
 * element table less `Client`, and each `held` handle turned into the `press`
 * reference the renderer already draws (owned by the Client's plugin).
 */
export function importClientTree(text: unknown, plugin: string, limits: ClientLimits): ImportedClientTree {
  if (typeof text !== 'string' || text.length > limits.chars) return { fault: 'the tree is too large' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { fault: 'the tree is not JSON' }
  }
  const handles: number[] = []
  let nodes = 0
  const walk = (node: unknown, depth: number): ModChild | null => {
    if (typeof node === 'string') return node
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null
    const { type, props, hover, held, children } = node as Record<string, unknown>
    if (typeof type !== 'string' || !CLIENT_TYPES.has(type) || ++nodes > limits.nodes || depth > limits.depth) return null
    const out: Record<string, unknown> = { type, props: props && typeof props === 'object' ? props : {} }
    if (hover && typeof hover === 'object') out.hover = hover
    if (PRESSABLE.has(type)) {
      if (!Number.isInteger(held)) return null
      handles.push(held as number)
      out.press = { plugin, handle: held }
      return out as ModElement
    }
    if (children !== undefined) {
      if (!Array.isArray(children)) return null
      const copied: ModChild[] = []
      for (const child of children) {
        const next = walk(child, depth + 1)
        if (next === null) return null
        copied.push(next)
      }
      out.children = copied
    }
    return out as ModElement
  }
  const tree = walk(parsed, 0)
  if (tree === null || typeof tree === 'string' || !isDrawableModTree(tree)) return { fault: 'the tree has an element SuperOne cannot draw' }
  return { tree, handles }
}

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', PageUp: 'pageup', PageDown: 'pagedown',
  Home: 'home', End: 'end', Enter: 'return', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', ' ': 'space',
}

/** A DOM key as the terminal names it to `surface.onKey`, or null for keys it never sends. */
export function clientKeyEvent(e: { key: string; ctrlKey: boolean; shiftKey: boolean; metaKey: boolean }): ClientKeyEvent | null {
  const key = NAMED_KEYS[e.key] ?? (e.key.length === 1 ? e.key : null)
  if (!key) return null
  return { key, ...(e.ctrlKey ? { ctrl: true } : {}), ...(e.shiftKey ? { shift: true } : {}), ...(e.metaKey ? { meta: true } : {}) }
}

const BUTTONS = ['left', 'middle', 'right'] as const

/** A DOM pointer event in the Client's own cells, as the terminal sends it. */
export function clientPointerEvent(
  type: ClientPointerEvent['type'],
  e: { clientX: number; clientY: number; button: number; shiftKey: boolean; altKey: boolean; ctrlKey: boolean },
  rect: { left: number; top: number },
  cell: { width: number; height: number },
): ClientPointerEvent {
  const button = type === 'down' || type === 'up' ? BUTTONS[e.button] : undefined
  return {
    type,
    x: Math.max(0, Math.floor((e.clientX - rect.left) / cell.width)),
    y: Math.max(0, Math.floor((e.clientY - rect.top) / cell.height)),
    ...(button ? { button } : {}),
    ...(e.shiftKey ? { shift: true } : {}),
    ...(e.altKey ? { alt: true } : {}),
    ...(e.ctrlKey ? { ctrl: true } : {}),
  }
}

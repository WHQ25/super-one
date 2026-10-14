import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import type { TerminalEvent } from '@superone/shared/agent-types'
import { requestOpenExternalLink } from '@/lib/external-link'
import { getTerminalFontFamily, getTerminalFontSize, getTerminalTheme } from './terminal-theme'
import type { TermInstance } from '@/stores/terminal'

export const SEARCH_DECORATIONS = {
  matchBackground: '#7a5c1f',
  activeMatchBackground: '#d18616',
  matchOverviewRuler: '#7a5c1f',
  activeMatchColorOverviewRuler: '#d18616',
} as const

export function createBaseXterm(): { xterm: XTerm; fit: FitAddon; search: SearchAddon } {
  const xterm = new XTerm({
    fontSize: getTerminalFontSize(),
    fontFamily: getTerminalFontFamily(),
    cursorBlink: true,
    allowProposedApi: true,
    allowTransparency: true,
    theme: getTerminalTheme(),
  })
  const fit = new FitAddon()
  xterm.loadAddon(fit)
  xterm.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      requestOpenExternalLink(uri)
    }),
  )
  xterm.loadAddon(new Unicode11Addon())
  xterm.unicode.activeVersion = '11'
  const search = new SearchAddon()
  xterm.loadAddon(search)
  return { xterm, fit, search }
}

/** Input events this close before xterm's data make it the user's: composed text lands a task after `compositionend`. */
const USER_INPUT_WINDOW_MS = 100
const userInputAt = new WeakMap<XTerm, number>()

/**
 * Send what an instance's xterm emits to its PTY while it is writable, saying
 * whether the user typed, pasted or composed it. xterm also answers the
 * program on its own (focus, device-status and mouse reports); only the
 * user's input may take a remote tab over.
 */
export function forwardTerminalInput(inst: TermInstance, terminalId: string): void {
  inst.xterm.onData((data) => {
    if (!inst.writable) return
    const input = performance.now() - (userInputAt.get(inst.xterm) ?? -Infinity) < USER_INPUT_WINDOW_MS
    void window.terminal.write(terminalId, data, input)
  })
}

/** Show an instance in `host`, opening it there (WebGL renderer, user-input tracking) the first time. */
export function mountTermInstance(inst: TermInstance, host: HTMLElement): void {
  if (inst.xterm.element) {
    host.replaceChildren(inst.xterm.element)
    return
  }
  host.replaceChildren()
  inst.xterm.open(host)
  const markInput = () => userInputAt.set(inst.xterm, performance.now())
  for (const type of ['keydown', 'paste', 'compositionend', 'input']) inst.xterm.element!.addEventListener(type, markInput, true)
  try {
    const webgl = new WebglAddon()
    webgl.onContextLoss(() => {
      try {
        webgl.dispose()
      } catch {
        /* renderer internals already gone — xterm reverts to the DOM renderer */
      }
      inst.webgl = undefined
    })
    inst.xterm.loadAddon(webgl)
    inst.webgl = webgl
    inst.xterm.clearTextureAtlas()
  } catch {
    /* WebGL unavailable — xterm falls back to the DOM renderer */
  }
}

/**
 * Push the live appearance (theme + font metrics) onto one instance.
 *
 * Instances outlive the panels that render them — they sit in a module/zustand
 * registry so a closed or navigated-away panel keeps its scrollback. That makes
 * "apply on change" insufficient: the light/dark class flips while the Settings
 * view has the whole coding workspace unmounted, so no observer is listening.
 * The subscribe-time call in `onTerminalThemeChange` re-syncs on every remount.
 */
export function applyTerminalAppearance(terminalId: string, inst: TermInstance): void {
  const fontSize = getTerminalFontSize()
  const fontFamily = getTerminalFontFamily()
  const metricsChanged =
    inst.xterm.options.fontSize !== fontSize || inst.xterm.options.fontFamily !== fontFamily
  if (!inst.xterm.options.allowTransparency) inst.xterm.options.allowTransparency = true
  inst.xterm.options.theme = getTerminalTheme()
  if (metricsChanged) {
    inst.xterm.options.fontSize = fontSize
    inst.xterm.options.fontFamily = fontFamily
  }
  inst.xterm.clearTextureAtlas()
  if (metricsChanged && inst.xterm.element?.isConnected) {
    inst.fit.fit()
    void window.terminal.resize(terminalId, inst.xterm.cols, inst.xterm.rows)
  }
}

export function applyTerminalEvent(inst: TermInstance, event: TerminalEvent): void {
  if (event.type === 'terminal_output') {
    if (event.toSeq <= inst.lastSeq) return
    inst.xterm.write(event.data)
    inst.lastSeq = event.toSeq
  } else if (event.type === 'terminal_snapshot') {
    inst.xterm.reset()
    inst.xterm.write(event.ansi)
    inst.lastSeq = event.snapshot.lastSeq
    inst.writable = event.snapshot.writableByMe
  } else if (event.type === 'terminal_snapshot_chunk') {
    let acc = inst.chunks.get(event.snapshotId)
    if (!acc) {
      acc = { total: event.total, parts: new Map() }
      inst.chunks.set(event.snapshotId, acc)
    }
    acc.parts.set(event.index, event.ansi)
    if (event.snapshot) {
      acc.lastSeq = event.snapshot.lastSeq
      inst.writable = event.snapshot.writableByMe
    }
    if (acc.parts.size === acc.total) {
      const ansi = Array.from({ length: acc.total }, (_, i) => acc!.parts.get(i) ?? '').join('')
      inst.xterm.reset()
      inst.xterm.write(ansi)
      if (acc.lastSeq !== undefined) inst.lastSeq = acc.lastSeq
      inst.chunks.delete(event.snapshotId)
    }
  } else if (event.type === 'terminal_owner_changed') {
    inst.writable = event.writableByMe
  } else if (event.type === 'terminal_exited') {
    inst.xterm.write('\r\n\x1b[2m[process exited]\x1b[0m\r\n')
  }
}

export function disposeTermInstance(inst: TermInstance): void {
  try {
    inst.webgl?.dispose()
  } catch {
    /* webgl renderer already torn down (context lost) */
  }
  inst.webgl = undefined
  inst.xterm.dispose()
}

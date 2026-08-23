import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { SearchAddon } from '@xterm/addon-search'
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

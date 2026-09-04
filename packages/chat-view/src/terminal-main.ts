import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import './terminal-theme.css'

type TerminalSnapshotMeta = {
  cwd?: string
  status?: string
  title?: string
  writableByMe?: boolean
}

type Paint = TerminalSnapshotMeta & {
  kind?: string
  type?: string
  ansi?: string
  data?: string
  chunk?: string
  snapshot?: TerminalSnapshotMeta
  exitCode?: number | null
  code?: string
  message?: string
}

type NativeHost = typeof globalThis & {
  __applyHost?: (message: unknown) => void
  ReactNativeWebView?: { postMessage(message: string): void }
}

const host = globalThis as NativeHost

const container = document.getElementById('terminal')
const meta = document.getElementById('meta')
if (!container || !meta) throw new Error('terminal host is missing')
const terminalContainer = container
const metaElement = meta

const terminal = new Terminal({
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: true,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  fontSize: 13,
  theme: {
    background: '#09090b',
    foreground: '#e4e4e7',
    cursor: '#f4f4f5',
    selectionBackground: '#3f3f46',
  },
})
const fit = new FitAddon()
terminal.loadAddon(fit)
terminal.open(terminalContainer)

let renderer = 'canvas'
try {
  const webgl = new WebglAddon()
  webgl.onContextLoss(() => webgl.dispose())
  terminal.loadAddon(webgl)
  renderer = 'webgl'
} catch {
  // WKWebView/Android System WebView may reject WebGL; canvas remains functional.
}

function post(message: unknown): void {
  host.ReactNativeWebView?.postMessage(JSON.stringify(message))
}

function setMeta(snapshot: TerminalSnapshotMeta | undefined): void {
  if (!snapshot) return
  const parts = [snapshot.title, snapshot.cwd, snapshot.status].filter(Boolean)
  if (snapshot.writableByMe === false) parts.push('read-only')
  metaElement.textContent = parts.join(' · ') || 'terminal'
}

function applyPaint(message: unknown): void {
  if (!message || typeof message !== 'object') return
  const outer = message as { type?: string; payload?: Paint }
  if (outer.type === 'reset') {
    terminal.reset()
    return
  }
  const paint = outer.payload ?? (outer as Paint)
  const kind = paint.kind ?? paint.type
  if (kind === 'replace') {
    terminal.reset()
    terminal.write(paint.ansi ?? paint.data ?? '')
    setMeta(paint.snapshot)
    return
  }
  if (kind === 'append' || kind === 'terminal_data') terminal.write(paint.data ?? paint.chunk ?? '')
  if (kind === 'meta' || paint.snapshot) setMeta(paint.snapshot ?? paint)
  if (kind === 'exited' || kind === 'terminal_exited') terminal.writeln(`\r\n[exited ${paint.exitCode ?? '?'}]`)
  if (kind === 'error' || kind === 'terminal_error') {
    terminal.writeln(`\r\n[error ${paint.code ?? ''} ${paint.message ?? ''}]`)
  }
}

host.__applyHost = applyPaint
document.addEventListener('message', ((event: MessageEvent<string>) => {
  try { applyPaint(JSON.parse(event.data)) } catch { /* ignore malformed host input */ }
}) as EventListener)
host.addEventListener('message', (event) => {
  let message = event.data
  if (typeof message === 'string') {
    try { message = JSON.parse(message) } catch { return }
  }
  applyPaint(message)
})

terminal.onData((data) => post({ type: 'terminalInput', data }))
let lastSize = ''
function refit(): void {
  fit.fit()
  const size = `${terminal.cols}x${terminal.rows}`
  if (size === lastSize) return
  lastSize = size
  post({ type: 'terminalResize', cols: terminal.cols, rows: terminal.rows })
}
new ResizeObserver(refit).observe(terminalContainer)
requestAnimationFrame(() => {
  refit()
  terminal.focus()
  post({ type: 'terminalReady', renderer })
})

const registry = new Map<string, Electron.WebviewTag>()

export interface BrowserConsoleEntry {
  level: 'log' | 'info' | 'warning' | 'error'
  text: string
  timestamp: string
}

const CONSOLE_CAP = 200
const consoleBuffers = new Map<string, BrowserConsoleEntry[]>()

function normalizeConsoleLevel(level: number | string): BrowserConsoleEntry['level'] {
  if (typeof level === 'number') return (['log', 'info', 'warning', 'error'][level] as BrowserConsoleEntry['level']) ?? 'log'
  const l = String(level).toLowerCase()
  if (l === 'error') return 'error'
  if (l === 'warning' || l === 'warn') return 'warning'
  if (l === 'info') return 'info'
  return 'log'
}

export function pushBrowserConsole(id: string, level: number | string, text: string): void {
  let buf = consoleBuffers.get(id)
  if (!buf) {
    buf = []
    consoleBuffers.set(id, buf)
  }
  buf.push({ level: normalizeConsoleLevel(level), text: text.slice(0, 2000), timestamp: new Date().toISOString() })
  if (buf.length > CONSOLE_CAP) buf.splice(0, buf.length - CONSOLE_CAP)
}

export interface ConsoleQuery {
  level?: BrowserConsoleEntry['level'][]
  grep?: string
  regex?: boolean
  ignoreCase?: boolean
  invert?: boolean
  max?: number
}

const DEFAULT_CONSOLE_LEVELS: BrowserConsoleEntry['level'][] = ['warning', 'error']

function buildGrepMatcher(pattern: string, regex: boolean, ignoreCase: boolean): (text: string) => boolean {
  if (regex) {
    let re: RegExp
    try {
      re = new RegExp(pattern, ignoreCase ? 'i' : '')
    } catch (err) {
      throw new Error(`Invalid console grep regex: ${err instanceof Error ? err.message : String(err)}`)
    }
    return (text) => re.test(text)
  }
  const needle = ignoreCase ? pattern.toLowerCase() : pattern
  return (text) => (ignoreCase ? text.toLowerCase() : text).includes(needle)
}

export function readBrowserConsole(id: string, query: ConsoleQuery = {}): BrowserConsoleEntry[] {
  const buf = consoleBuffers.get(id) ?? []
  const levels = new Set(query.level?.length ? query.level : DEFAULT_CONSOLE_LEVELS)
  let list = buf.filter((e) => levels.has(e.level))
  if (query.grep) {
    const matches = buildGrepMatcher(query.grep, query.regex === true, query.ignoreCase !== false)
    const invert = query.invert === true
    list = list.filter((e) => matches(e.text) !== invert)
  }
  const max = query.max && query.max > 0 ? query.max : 50
  return list.slice(-max)
}

export function clearBrowserConsole(id: string): void {
  consoleBuffers.delete(id)
}

export function registerBrowserWebview(id: string, el: Electron.WebviewTag | null): () => void {
  if (el) registry.set(id, el)
  return () => {
    if (registry.get(id) === el) registry.delete(id)
  }
}

export function isBrowserRegistered(id: string): boolean {
  return registry.has(id)
}

export function browserIdByWebContentsId(webContentsId: number): string | null {
  for (const [id, el] of registry) {
    try {
      if (el.getWebContentsId() === webContentsId) return id
    } catch {
      // webview not yet attached — skip
    }
  }
  return null
}

export function browserNavigate(id: string, url: string): void {
  registry.get(id)?.loadURL(url)
}

export function browserGoBack(id: string): void {
  registry.get(id)?.goBack()
}

export function browserGoForward(id: string): void {
  registry.get(id)?.goForward()
}

export function browserReload(id: string): void {
  registry.get(id)?.reload()
}

export function browserStop(id: string): void {
  registry.get(id)?.stop()
}

export function browserOpenDevTools(id: string): void {
  const wv = registry.get(id)
  if (!wv) return
  if (wv.isDevToolsOpened()) wv.closeDevTools()
  else wv.openDevTools()
}

export async function browserCapture(id: string, rect?: Electron.Rectangle): Promise<Electron.NativeImage | null> {
  const wv = registry.get(id)
  if (!wv) return null
  return rect ? wv.capturePage(rect) : wv.capturePage()
}

export async function browserExecJs(id: string, script: string): Promise<unknown> {
  const wv = registry.get(id)
  if (!wv) return null
  return wv.executeJavaScript(script)
}

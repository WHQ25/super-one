export type BrowserOp =
  | 'snapshot'
  | 'query'
  | 'inspect'
  | 'screenshot'
  | 'click'
  | 'hover'
  | 'type'
  | 'navigate'
  | 'wait_for'
  | 'press'
  | 'scroll'
  | 'drag'
  | 'select'
  | 'open'
  | 'evaluate'
  | 'tabs'
  | 'resize'
  | 'network_start'
  | 'network_stop'
  | 'network_wait'
  | 'network_body'
  | 'cookies'
  | 'upload_file'
  | 'emulate'
  | 'mock'

const BROWSER_OPS = new Set<BrowserOp>([
  'snapshot', 'query', 'inspect', 'screenshot', 'click', 'hover', 'type', 'navigate',
  'wait_for', 'press', 'scroll', 'drag', 'select', 'open', 'evaluate', 'tabs', 'resize',
  'network_start', 'network_stop', 'network_wait', 'network_body', 'cookies', 'upload_file', 'emulate', 'mock',
])

/** Read-only ops whose JSON result is worth expanding; the rest are lean actions. */
const READ_OPS = new Set<BrowserOp>(['snapshot', 'query', 'inspect', 'tabs', 'evaluate', 'network_stop', 'network_wait', 'network_body', 'cookies'])

/** Ops that report success/failure via an `ok` field (or an error). */
const ACTION_OPS = new Set<BrowserOp>(['click', 'hover', 'type', 'press', 'scroll', 'drag', 'select', 'navigate', 'wait_for', 'open', 'resize', 'network_start', 'upload_file', 'emulate', 'mock'])

/** Strip the `browser_` prefix; return the op if this is a known browser tool. */
export function getBrowserOp(mcpToolName: string): BrowserOp | null {
  if (!mcpToolName.startsWith('browser_')) return null
  const op = mcpToolName.slice('browser_'.length) as BrowserOp
  return BROWSER_OPS.has(op) ? op : null
}

/** i18n key suffix (under chat.toolBlock.browser) for the op's verb label. */
export function browserVerbKey(op: BrowserOp): string {
  if (op === 'wait_for') return 'waitFor'
  if (op === 'upload_file') return 'uploadFile'
  if (op === 'network_start') return 'networkStart'
  if (op === 'network_stop') return 'networkStop'
  if (op === 'network_wait') return 'networkWait'
  if (op === 'network_body') return 'networkBody'
  return op
}

export function isReadBrowserOp(op: BrowserOp): boolean {
  return READ_OPS.has(op)
}

function s(v: unknown): string {
  return v == null ? '' : String(v)
}

function stripProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function truncate(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) + '…' : t
}

const SECRET_HINT = /password|passwd|\bpwd\b|\bpass\b|otp|secret|token|credential|cvv|ssn|creditcard|cardnumber|ccnum|api[_-]?key/i

function isSecretType(selector: string, text: string): boolean {
  if (selector && SECRET_HINT.test(selector)) return true
  const t = text.trim()
  return t.length >= 16 && !/\s/.test(t) && /[a-z]/i.test(t) && /[0-9]/.test(t)
}

/** A language-neutral summary of the tool's target, derived from its input. */
export function browserInputSummary(op: BrowserOp, p: Record<string, unknown>): string {
  switch (op) {
    case 'navigate':
      if (p.action != null) return s(p.action)
      if (p.url != null) return stripProtocol(s(p.url))
      if (p.port != null) return `localhost:${s(p.port)}${p.path != null ? s(p.path) : ''}`
      return ''
    case 'open':
      return p.url != null ? stripProtocol(s(p.url)) : ''
    case 'click':
    case 'hover':
      if (p.selector != null) return s(p.selector)
      if (p.text != null) return `“${s(p.text)}”`
      if (p.x != null && p.y != null) return `(${s(p.x)}, ${s(p.y)})`
      return ''
    case 'type': {
      const selector = p.selector != null ? s(p.selector) : ''
      const raw = s(p.text)
      const text = isSecretType(selector, raw) ? '••••••' : truncate(raw, 40)
      return selector ? `${selector} ← ${text}` : text
    }
    case 'press': {
      const mods = Array.isArray(p.modifiers) ? (p.modifiers as string[]).join('+') : ''
      const key = s(p.key)
      return mods ? `${mods}+${key}` : key
    }
    case 'scroll':
      if (p.selector != null) return s(p.selector)
      return [p.deltaX != null ? `x:${s(p.deltaX)}` : '', p.deltaY != null ? `y:${s(p.deltaY)}` : ''].filter(Boolean).join(' ')
    case 'select': {
      const val = p.value ?? p.label ?? (p.index != null ? `#${s(p.index)}` : (p.checked != null ? s(p.checked) : ''))
      const valStr = s(val)
      return p.selector != null ? `${s(p.selector)}${valStr ? ` = ${valStr}` : ''}` : valStr
    }
    case 'drag': {
      const target = (t: unknown): string => {
        const g = t && typeof t === 'object' ? (t as Record<string, unknown>) : {}
        if (g.selector != null) return s(g.selector)
        if (g.text != null) return `“${s(g.text)}”`
        if (g.x != null && g.y != null) return `(${s(g.x)}, ${s(g.y)})`
        return '?'
      }
      return `${target(p.from)} → ${target(p.to)}`
    }
    case 'inspect':
    case 'screenshot':
      return s(p.selector)
    case 'query':
      return [
        p.role != null ? s(p.role) : '',
        p.text != null ? `“${s(p.text)}”` : '',
        p.selector != null ? s(p.selector) : '',
      ].filter(Boolean).join(' · ')
    case 'snapshot':
      return s(p.filter)
    case 'wait_for':
      return [
        p.selector != null ? s(p.selector) : '',
        p.selectorGone != null ? `!${s(p.selectorGone)}` : '',
        p.text != null ? `“${s(p.text)}”` : '',
        p.urlIncludes != null ? `url:${s(p.urlIncludes)}` : '',
      ].filter(Boolean).join(' · ')
    case 'evaluate':
      return truncate(s(p.expression), 60)
    case 'tabs':
      return ''
    case 'resize':
      if (p.reset) return 'reset'
      if (p.preset != null) return s(p.preset)
      if (p.width != null && p.height != null) return `${s(p.width)}×${s(p.height)}`
      return ''
    case 'network_start':
      return [
        p.match != null ? s(p.match) : '',
        Array.isArray(p.resourceTypes) ? (p.resourceTypes as unknown[]).map(s).join(',') : '',
      ].filter(Boolean).join(' · ')
    case 'network_stop':
      return p.keep ? 'peek' : ''
    case 'network_wait':
      return s(p.url)
    case 'network_body':
      return s(p.requestId)
    case 'cookies':
      return Array.isArray(p.urls) ? (p.urls as unknown[]).map((u) => stripProtocol(s(u))).join(', ') : ''
    case 'upload_file': {
      const n = Array.isArray(p.files) ? (p.files as unknown[]).length : 0
      return p.selector != null ? `${s(p.selector)}${n ? ` ← ${n}` : ''}` : (n ? String(n) : '')
    }
    case 'emulate':
      if (p.reset) return 'reset'
      return [
        p.width != null && p.height != null ? `${s(p.width)}×${s(p.height)}` : '',
        p.mobile ? 'mobile' : '',
        p.colorScheme != null ? s(p.colorScheme) : '',
        p.timezone != null ? s(p.timezone) : '',
        p.locale != null ? s(p.locale) : '',
      ].filter(Boolean).join(' · ')
    case 'mock':
      if (p.clear) return 'clear'
      return p.url != null ? s(p.url) : ''
  }
}

export interface BrowserResultInfo {
  status: 'ok' | 'error' | 'neutral'
  errorText?: string
  count?: { kind: 'elements' | 'matches' | 'tabs' | 'requests' | 'cookies'; n: number }
  notFound?: boolean
  imagePath?: string
}

function cleanError(result: string | undefined): string | undefined {
  if (!result) return undefined
  const text = result.replace(/^\[Error\]\s*/, '').replace(/<\/?tool_use_error>/g, '').trim()
  return text || undefined
}

/** Read/list tools return TOON (not JSON) to save tokens. */
const TOON_RESULT_OPS = new Set<BrowserOp>([
  'snapshot', 'query', 'tabs', 'cookies',
  'network_start', 'network_stop', 'network_wait', 'network_body',
])

/** Pull a count from a TOON tabular array header `name[N]{...}:` without a full decode. */
function toonArrayCount(result: string, name: string): number | undefined {
  const m = result.match(new RegExp(`${name}\\[(\\d+)\\]`))
  return m ? Number(m[1]) : undefined
}

function parseToonResult(op: BrowserOp, result: string): BrowserResultInfo {
  const count = (kind: 'matches' | 'tabs' | 'requests' | 'cookies', n: number | undefined): BrowserResultInfo =>
    n != null ? { status: 'neutral', count: { kind, n } } : { status: 'neutral' }
  switch (op) {
    case 'network_start':
      return { status: 'ok' }
    case 'network_stop':
      return count('requests', toonArrayCount(result, 'requests'))
    case 'query': {
      const total = result.match(/(?:^|\n)total: (\d+)/)
      return count('matches', total ? Number(total[1]) : toonArrayCount(result, 'matches'))
    }
    case 'tabs':
      return count('tabs', toonArrayCount(result, 'tabs'))
    case 'cookies':
      return count('cookies', toonArrayCount(result, 'cookies'))
    default:
      return { status: 'neutral' } // snapshot, network_wait, network_body
  }
}

/** Parse a browser tool's result into a status + optional count/notFound summary. */
export function parseBrowserResult(op: BrowserOp, result: string | undefined, isError: boolean): BrowserResultInfo {
  if (isError) return { status: 'error', errorText: cleanError(result) }
  if (!result) return { status: 'neutral' }
  if (TOON_RESULT_OPS.has(op)) return parseToonResult(op, result)

  let data: unknown
  try { data = JSON.parse(result) } catch { return { status: 'neutral' } }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null

  if (obj && obj.ok === false) {
    return { status: 'error', errorText: obj.error != null ? String(obj.error) : undefined }
  }

  switch (op) {
    case 'inspect':
      if (obj && obj.exists === false) return { status: 'neutral', notFound: true }
      return { status: 'neutral' }
    case 'screenshot':
      return { status: 'ok', imagePath: typeof obj?.path === 'string' ? obj.path : undefined }
    default:
      return { status: ACTION_OPS.has(op) ? 'ok' : 'neutral' }
  }
}

/** Browser tool presentation model shared by desktop and mobile hosts. */
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
  | 'close'
  | 'evaluate'
  | 'tabs'
  | 'resize'
  | 'network_start'
  | 'network_stop'
  | 'network_wait'
  | 'network_body'
  | 'cookies'
  | 'upload_file'
  | 'download'
  | 'list_downloads'
  | 'emulate'
  | 'mock'
  | 'action_list'
  | 'action_save'
  | 'action_do'
  | 'act'
  | 'tools_list'
  | 'tools_call'

const BROWSER_OPS = new Set<BrowserOp>([
  'snapshot', 'query', 'inspect', 'screenshot', 'click', 'hover', 'type', 'navigate',
  'wait_for', 'press', 'scroll', 'drag', 'select', 'open', 'close', 'evaluate', 'tabs', 'resize',
  'network_start', 'network_stop', 'network_wait', 'network_body', 'cookies', 'upload_file',
  'download', 'list_downloads', 'emulate', 'mock', 'action_list', 'action_save', 'action_do',
  'act', 'tools_list', 'tools_call',
])

/** Read-only ops whose JSON result is worth expanding; the rest are lean actions. */
const READ_OPS = new Set<BrowserOp>(['snapshot', 'query', 'inspect', 'tabs', 'evaluate', 'network_stop', 'network_wait', 'network_body', 'cookies', 'list_downloads', 'action_list', 'tools_list'])

/** Ops that report success/failure via an `ok` field (or an error). */
const ACTION_OPS = new Set<BrowserOp>(['click', 'hover', 'type', 'press', 'scroll', 'drag', 'select', 'navigate', 'wait_for', 'open', 'close', 'resize', 'network_start', 'upload_file', 'download', 'emulate', 'mock', 'action_save', 'action_do', 'act', 'tools_call'])

const NETWORK_ACTION_OP: Record<string, BrowserOp> = {
  start: 'network_start',
  stop: 'network_stop',
  wait: 'network_wait',
  body: 'network_body',
  download: 'download',
  downloads: 'list_downloads',
  cookies: 'cookies',
  mock: 'mock',
  emulate: 'emulate',
}

const ACTION_CATALOG_OP: Record<string, BrowserOp> = {
  list: 'action_list',
  save: 'action_save',
  do: 'action_do',
}

const TABS_ACTION_OP: Record<string, BrowserOp> = {
  list: 'tabs',
  open: 'open',
  navigate: 'navigate',
  back: 'navigate',
  forward: 'navigate',
  reload: 'navigate',
  close: 'close',
}

/** One `browser_act` step type → the op that renders it as if it were its own tool. */
function actTypeOp(type: unknown): BrowserOp | null {
  if (type === 'upload') return 'upload_file'
  return typeof type === 'string' && BROWSER_OPS.has(type as BrowserOp) ? (type as BrowserOp) : null
}

/** Strip the `browser_` prefix; compact tools resolve through action/type args. */
export function getBrowserOp(mcpToolName: string, params?: Record<string, unknown>): BrowserOp | null {
  if (!mcpToolName.startsWith('browser_')) return null
  const rest = mcpToolName.slice('browser_'.length)
  if (rest === 'act') {
    const list = Array.isArray(params?.actions) ? (params.actions as Array<{ type?: string }>) : []
    // A batch is its own op: reporting it as its first action's verb would claim a
    // `click` did what a click-then-type-then-press transaction actually did.
    if (list.length > 1) return 'act'
    // Absent/partial `actions` is the streaming case — stay on the single-action
    // default so a plain click does not flip verbs once its input finishes arriving.
    return actTypeOp(list[0]?.type) ?? 'click'
  }
  if (rest === 'network') {
    const action = typeof params?.action === 'string' ? params.action : ''
    if (action === 'emulate' && (params?.preset != null || params?.reset === true || (params?.width != null && params?.height != null))) {
      const needsFull = ['deviceScaleFactor', 'mobile', 'userAgent', 'colorScheme', 'timezone', 'locale', 'latitude', 'longitude']
        .some((k) => params?.[k] != null)
      if (!needsFull) return 'resize'
    }
    return NETWORK_ACTION_OP[action] ?? 'network_start'
  }
  if (rest === 'action') {
    const action = typeof params?.action === 'string' ? params.action : 'list'
    return ACTION_CATALOG_OP[action] ?? 'action_list'
  }
  if (rest === 'tabs') {
    const action = typeof params?.action === 'string' ? params.action : 'list'
    return TABS_ACTION_OP[action] ?? 'tabs'
  }
  if (rest === 'query' && params?.op === 'inspect') return 'inspect'
  if (rest === 'snapshot') {
    const include = Array.isArray(params?.include) ? params.include : []
    if (include.length === 1 && include[0] === 'screenshot') return 'screenshot'
  }
  return BROWSER_OPS.has(rest as BrowserOp) ? (rest as BrowserOp) : null
}

const VERB_BASE: Record<BrowserOp, string> = {
  snapshot: 'snapshot',
  query: 'query',
  inspect: 'inspect',
  screenshot: 'screenshot',
  click: 'click',
  hover: 'hover',
  type: 'type',
  navigate: 'navigate',
  wait_for: 'waitFor',
  press: 'press',
  scroll: 'scroll',
  drag: 'drag',
  select: 'select',
  open: 'open',
  close: 'close',
  evaluate: 'evaluate',
  tabs: 'tabs',
  resize: 'resize',
  network_start: 'networkStart',
  network_stop: 'networkStop',
  network_wait: 'networkWait',
  network_body: 'networkBody',
  cookies: 'cookies',
  upload_file: 'uploadFile',
  download: 'download',
  list_downloads: 'listDownloads',
  emulate: 'emulate',
  mock: 'mock',
  action_list: 'actionList',
  action_save: 'actionSave',
  action_do: 'actionDo',
  act: 'act',
  tools_list: 'toolsList',
  tools_call: 'toolsCall',
}

const VERB_STREAMING: Record<BrowserOp, string> = {
  snapshot: 'snapshotting',
  query: 'querying',
  inspect: 'inspecting',
  screenshot: 'screenshotting',
  click: 'clicking',
  hover: 'hovering',
  type: 'typing',
  navigate: 'navigating',
  wait_for: 'waitingFor',
  press: 'pressing',
  scroll: 'scrolling',
  drag: 'dragging',
  select: 'selecting',
  open: 'opening',
  close: 'closing',
  evaluate: 'evaluating',
  tabs: 'listingTabs',
  resize: 'resizing',
  network_start: 'recordingNetwork',
  network_stop: 'collectingNetwork',
  network_wait: 'waitingForRequest',
  network_body: 'loadingResponseBody',
  cookies: 'readingCookies',
  upload_file: 'uploadingFile',
  download: 'downloading',
  list_downloads: 'listingDownloads',
  emulate: 'emulating',
  mock: 'mocking',
  action_list: 'listingActions',
  action_save: 'savingAction',
  action_do: 'doingAction',
  act: 'acting',
  tools_list: 'listingPageTools',
  tools_call: 'callingPageTool',
}

/** i18n key suffix (under chat.toolBlock.browser) for the op's verb label. */
export function browserVerbKey(op: BrowserOp, streaming = false): string {
  return streaming ? VERB_STREAMING[op] : VERB_BASE[op]
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

/** `type selector` for one batch step, so the row lists what actually ran. */
function actStepSummary(step: Record<string, unknown>): string {
  const op = actTypeOp(step.type)
  if (!op) return ''
  const target = browserInputSummary(op, step)
  return target ? `${s(step.type)} ${target}` : s(step.type)
}

/** A language-neutral summary of the tool's target, derived from its input. */
export function browserInputSummary(op: BrowserOp, p: Record<string, unknown>): string {
  const steps = Array.isArray(p.actions) ? (p.actions as Array<Record<string, unknown>>) : null
  if (steps) {
    // A batch summarises every step; a single action reads its own args, which live
    // one level down in `actions[0]` rather than at the top level.
    if (op === 'act') return steps.map(actStepSummary).filter(Boolean).join(' · ')
    if (steps.length === 1) p = { ...p, ...steps[0] }
  }
  switch (op) {
    case 'navigate':
      if (p.action != null) return s(p.action)
      if (p.url != null) return stripProtocol(s(p.url))
      if (p.port != null) return `localhost:${s(p.port)}${p.path != null ? s(p.path) : ''}`
      return ''
    case 'open':
      return p.url != null ? stripProtocol(s(p.url)) : ''
    // The tab id is a UUID — meaningless to the user, and the closed tab's url is
    // no longer resolvable from the store by the time the row renders. The count of
    // tabs actually closed comes from the result instead.
    case 'close':
      return ''
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
    case 'download':
      return p.url != null ? stripProtocol(s(p.url)) : (p.filename != null ? s(p.filename) : '')
    case 'list_downloads':
      return p.state != null && p.state !== 'all' ? s(p.state) : ''
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
    case 'action_list':
      return s(p.domain)
    case 'act':
      return ''
    case 'action_save':
    case 'action_do':
      return [s(p.domain), s(p.name)].filter(Boolean).join('/')
    case 'tools_list':
      return ''
    case 'tools_call':
      return s(p.name)
  }
}

export interface BrowserDownloadInfo {
  phase: 'streaming' | 'background' | 'completed' | 'failed'
  taskId?: string
  path?: string
  filename?: string
  bytes?: number
  mimeType?: string
  url?: string
  error?: string
  message?: string
}

export interface BrowserResultInfo {
  status: 'ok' | 'error' | 'denied' | 'neutral'
  errorText?: string
  count?: { kind: 'elements' | 'matches' | 'tabs' | 'requests' | 'cookies' | 'downloads' | 'actions'; n: number }
  notFound?: boolean
  imagePath?: string
  download?: BrowserDownloadInfo
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
  if (obj?.status === 'denied' || obj?.status === 'cancelled') {
    return {
      status: 'denied',
      errorText: typeof obj.reason === 'string' ? obj.reason : undefined,
    }
  }

  switch (op) {
    case 'inspect':
      if (obj && obj.exists === false) return { status: 'neutral', notFound: true }
      return { status: 'neutral' }
    case 'screenshot':
      return { status: 'ok', imagePath: typeof obj?.path === 'string' ? obj.path : undefined }
    case 'close': {
      // A partly-failed batch already returned above on `ok === false`, so anything
      // reaching here closed everything it was asked to.
      const n = Array.isArray(obj?.closed) ? obj.closed.length : undefined
      return n != null ? { status: 'ok', count: { kind: 'tabs', n } } : { status: 'ok' }
    }
    case 'download': {
      if (obj?.status === 'background') {
        return {
          status: 'neutral',
          download: {
            phase: 'background',
            taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
            url: typeof obj.url === 'string' ? obj.url : undefined,
            filename: typeof obj.filename === 'string' ? obj.filename : undefined,
            bytes: typeof obj.bytes === 'number' ? obj.bytes : undefined,
            mimeType: typeof obj.mimeType === 'string' ? obj.mimeType : undefined,
            message: typeof obj.message === 'string' ? obj.message : undefined,
          },
        }
      }
      if (obj?.status === 'failed' || obj?.error) {
        return {
          status: 'error',
          errorText: typeof obj.error === 'string' ? obj.error : undefined,
          download: {
            phase: 'failed',
            taskId: typeof obj.taskId === 'string' ? obj.taskId : undefined,
            url: typeof obj.url === 'string' ? obj.url : undefined,
            error: typeof obj.error === 'string' ? obj.error : undefined,
          },
        }
      }
      return {
        status: 'ok',
        download: {
          phase: 'completed',
          taskId: typeof obj?.taskId === 'string' ? obj.taskId : undefined,
          path: typeof obj?.path === 'string' ? obj.path : undefined,
          filename: typeof obj?.filename === 'string' ? obj.filename : undefined,
          bytes: typeof obj?.bytes === 'number' ? obj.bytes : undefined,
          mimeType: typeof obj?.mimeType === 'string' ? obj.mimeType : undefined,
          url: typeof obj?.url === 'string' ? obj.url : undefined,
        },
      }
    }
    case 'list_downloads': {
      const n = typeof obj?.count === 'number' ? obj.count : (Array.isArray(obj?.downloads) ? obj.downloads.length : undefined)
      return n != null ? { status: 'neutral', count: { kind: 'downloads', n } } : { status: 'neutral' }
    }
    case 'action_list': {
      const n = typeof obj?.count === 'number' ? obj.count : (Array.isArray(obj?.actions) ? obj.actions.length : undefined)
      return n != null ? { status: 'neutral', count: { kind: 'actions', n } } : { status: 'neutral' }
    }
    default:
      return { status: ACTION_OPS.has(op) ? 'ok' : 'neutral' }
  }
}

export type BrowserDownloadListState = 'progressing' | 'completed' | 'cancelled' | 'interrupted' | string

export interface BrowserDownloadListItem {
  filename: string
  path?: string
  bytes?: number
  state?: BrowserDownloadListState
  url?: string
}

/** Parse browser_list_downloads JSON result into a human-friendly item list. */
export function parseListDownloadsResult(result: string | undefined): BrowserDownloadListItem[] {
  if (!result) return []
  let data: unknown
  try { data = JSON.parse(result) } catch { return [] }
  const obj = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  const raw = Array.isArray(obj?.downloads) ? obj.downloads : (Array.isArray(data) ? data : [])
  const items: BrowserDownloadListItem[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const d = entry as Record<string, unknown>
    const filename = typeof d.filename === 'string' ? d.filename
      : typeof d.path === 'string' ? d.path.split('/').pop() || d.path
        : typeof d.url === 'string' ? d.url.split('/').pop()?.split('?')[0] || d.url
          : ''
    if (!filename && d.path == null && d.url == null) continue
    items.push({
      filename: filename || 'download',
      path: typeof d.path === 'string' ? d.path : undefined,
      bytes: typeof d.bytes === 'number' ? d.bytes : undefined,
      state: typeof d.state === 'string' ? d.state : undefined,
      url: typeof d.url === 'string' ? d.url : undefined,
    })
  }
  return items
}

export type ComputerOp =
  | 'apps'
  | 'snapshot'
  | 'zoom'
  | 'query'
  | 'act'
  | 'wait_for'

const COMPUTER_OPS = new Set<ComputerOp>([
  'apps',
  'snapshot',
  'zoom',
  'query',
  'act',
  'wait_for',
])

type ComputerOutcome = 'worked' | 'didnt' | 'unknown'
type ComputerWaitStatus = 'preexisting' | 'verified' | 'failed'

export interface ComputerResultInfo {
  status: 'ok' | 'error' | 'neutral'
  errorText?: string
  imagePath?: string
  app?: string
  /** macOS bundle id when present in the tool result (for app-icon UI). */
  bundleId?: string
  title?: string
  stateId?: string
  outcome?: ComputerOutcome
  waitStatus?: ComputerWaitStatus
  counts?: {
    granted?: number
    running?: number
    roots?: number
    matches?: number
    evidence?: number
    /** computer_apps list page size / total after filter. */
    apps?: number
    total?: number
  }
}

/**
 * Session-local cache so streaming act/query/wait can show the target app icon
 * before the tool result (with successorRoot.bundleId) arrives.
 * Populated from prior launch/focus/snapshot/act/query/wait results.
 */
const stateIdToBundleId = new Map<string, string>()
let lastTargetBundleId: string | undefined

/** @internal vitest only */
export function resetComputerUseTargetCacheForTests(): void {
  stateIdToBundleId.clear()
  lastTargetBundleId = undefined
}

function rememberComputerUseTarget(
  info: ComputerResultInfo,
  params?: Record<string, unknown>,
): void {
  if (!info.bundleId) return
  lastTargetBundleId = info.bundleId
  if (info.stateId) stateIdToBundleId.set(info.stateId, info.bundleId)
  // act/query/zoom/wait_for take a base stateId — map it so the next streaming
  // call with the same state still resolves the icon.
  const inputState =
    typeof params?.stateId === 'string' ? params.stateId.trim() : ''
  if (inputState) stateIdToBundleId.set(inputState, info.bundleId)
}

/** Best-effort extract when full JSON parse fails (e.g. truncated huge diffs). */
function scrapeBundleId(raw: string): string | undefined {
  // Prefer the first reverse-DNS-looking bundle id in the payload.
  const matches = raw.matchAll(
    /"bundleId"\s*:\s*"([A-Za-z0-9][A-Za-z0-9._-]{0,253})"/g,
  )
  for (const m of matches) {
    const id = m[1]
    if (id && id.includes('.')) return id
  }
  return undefined
}

export function getComputerOp(mcpToolName: string): ComputerOp | null {
  if (!mcpToolName.startsWith('computer_')) return null
  let bare = mcpToolName.slice('computer_'.length)
  // Deprecated MCP name — map to current UI op.
  if (bare === 'observe') bare = 'snapshot'
  const op = bare as ComputerOp
  return COMPUTER_OPS.has(op) ? op : null
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function truncate(text: string, max = 48): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max
    ? `${normalized.slice(0, max)}\u2026`
    : normalized
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function formatRegion(value: unknown): string {
  if (!Array.isArray(value) || value.length !== 4) return ''
  return `[${value.map(stringValue).join(', ')}]`
}

function formatPoint(x: unknown, y: unknown): string {
  return x != null && y != null ? `(${stringValue(x)}, ${stringValue(y)})` : ''
}

function formatCondition(value: unknown): string {
  const condition = asRecord(value)
  if (!condition) return ''
  const ref = stringValue(condition.ref)
  switch (condition.kind) {
    case 'exists':
      return ref
    case 'notExists':
      return ref ? `!${ref}` : ''
    case 'textEquals':
      return [ref, `= \u201c${truncate(stringValue(condition.text), 32)}\u201d`]
        .filter(Boolean)
        .join(' ')
    case 'textContains':
      return [ref, `~ \u201c${truncate(stringValue(condition.text), 32)}\u201d`]
        .filter(Boolean)
        .join(' ')
    case 'valueEquals':
      return [ref, '= \u2022\u2022\u2022\u2022\u2022\u2022']
        .filter(Boolean)
        .join(' ')
    default:
      return ''
  }
}

function formatAction(value: unknown): string {
  const action = asRecord(value)
  if (!action) return ''
  const ref = stringValue(action.ref)
  switch (action.type) {
    case 'press':
      return ref
    case 'click':
      return ref || formatPoint(action.x, action.y)
    case 'setText':
    case 'typeText':
      return ref
        ? `${ref} \u2190 \u2022\u2022\u2022\u2022\u2022\u2022`
        : '\u2022\u2022\u2022\u2022\u2022\u2022'
    case 'keypress':
      return Array.isArray(action.keys)
        ? action.keys.map(stringValue).join('+')
        : ''
    case 'scroll':
      return [
        ref,
        action.dx != null ? `x:${stringValue(action.dx)}` : '',
        action.dy != null ? `y:${stringValue(action.dy)}` : '',
      ]
        .filter(Boolean)
        .join(' ')
    case 'drag': {
      const path = Array.isArray(action.path)
        ? (action.path.map(asRecord).filter(Boolean) as Record<
            string,
            unknown
          >[])
        : []
      if (path.length < 2) return ''
      const first = path[0]
      const last = path[path.length - 1]
      return `${formatPoint(first.x, first.y)} \u2192 ${formatPoint(last.x, last.y)}`
    }
    case 'moveMouse':
      return formatPoint(action.x, action.y)
    default:
      return ''
  }
}

export function computerVerbKey(
  op: ComputerOp,
  params: Record<string, unknown>,
  streaming = false,
): string {
  if (op === 'apps') {
    const action =
      params.action === 'focus' || params.action === 'launch'
        ? params.action
        : 'apps'
    if (streaming)
      return action === 'focus'
        ? 'focusing'
        : action === 'launch'
          ? 'launching'
          : 'listingApps'
    return action
  }
  if (op === 'query') {
    const queryOp =
      params.op === 'search' ||
      params.op === 'expand' ||
      params.op === 'inspect'
        ? params.op
        : 'query'
    if (streaming)
      return queryOp === 'search'
        ? 'searching'
        : queryOp === 'expand'
          ? 'expanding'
          : queryOp === 'inspect'
            ? 'inspecting'
            : 'querying'
    return queryOp
  }
  if (op === 'act') {
    const actions = Array.isArray(params.actions) ? params.actions : []
    const action = actions.length === 1 ? asRecord(actions[0]) : null
    const type = action?.type
    const base =
      type === 'click'
        ? 'click'
        : type === 'setText' || type === 'typeText'
          ? 'type'
          : type === 'press' || type === 'keypress'
            ? 'press'
            : type === 'scroll'
              ? 'scroll'
              : type === 'drag'
                ? 'drag'
                : type === 'moveMouse'
                  ? 'movePointer'
                  : 'act'
    if (!streaming) return base
    return base === 'click'
      ? 'clicking'
      : base === 'type'
        ? 'typing'
        : base === 'press'
          ? 'pressing'
          : base === 'scroll'
            ? 'scrolling'
            : base === 'drag'
              ? 'dragging'
              : base === 'movePointer'
                ? 'movingPointer'
                : 'acting'
  }

  const keys: Record<
    Exclude<ComputerOp, 'apps' | 'query' | 'act'>,
    [string, string]
  > = {
    snapshot: ['snapshot', 'snapshotting'],
    zoom: ['zoom', 'zooming'],
    wait_for: ['waitFor', 'waitingFor'],
  }
  return keys[op][streaming ? 1 : 0]
}

export function computerInputSummary(
  op: ComputerOp,
  params: Record<string, unknown>,
): string {
  switch (op) {
    case 'apps':
      return params.action === 'focus' || params.action === 'launch'
        ? stringValue(params.app)
        : ''
    case 'snapshot':
      return [
        stringValue(params.root),
        params.mode != null && params.mode !== 'fused'
          ? stringValue(params.mode)
          : '',
        params.capture != null && params.capture !== 'window'
          ? stringValue(params.capture)
          : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
    case 'zoom':
      return [stringValue(params.stateId), formatRegion(params.region)]
        .filter(Boolean)
        .join(' \u00b7 ')
    case 'query': {
      const target =
        params.op === 'search'
          ? `\u201c${truncate(stringValue(params.text))}\u201d`
          : stringValue(params.ref)
      const depth =
        params.op === 'expand' && params.depth != null
          ? `depth:${stringValue(params.depth)}`
          : ''
      return [stringValue(params.stateId), target, depth]
        .filter(Boolean)
        .join(' \u00b7 ')
    }
    case 'act': {
      const actions = Array.isArray(params.actions) ? params.actions : []
      const first = actions.length > 0 ? formatAction(actions[0]) : ''
      const remaining = actions.length > 1 ? `+${actions.length - 1}` : ''
      return [
        first,
        remaining,
        params.delivery != null && params.delivery !== 'app-directed'
          ? stringValue(params.delivery)
          : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
    }
    case 'wait_for':
      return [
        formatCondition(params.condition),
        params.timeoutMs != null ? `${stringValue(params.timeoutMs)}ms` : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 ')
  }
}

export function isReadComputerOp(
  op: ComputerOp,
  params: Record<string, unknown>,
): boolean {
  if (op === 'apps') return params.action == null || params.action === 'list'
  return op === 'snapshot' || op === 'zoom' || op === 'query'
}

function cleanError(result: string | undefined): string | undefined {
  if (!result) return undefined
  const text = result
    .replace(/^\[Error\]\s*/, '')
    .replace(/<\/?tool_use_error>/g, '')
    .trim()
  return text || undefined
}

function imagePath(value: unknown): string | undefined {
  const image = asRecord(value)
  return typeof image?.path === 'string' && image.path ? image.path : undefined
}

function rootIdentity(value: unknown): {
  app?: string
  bundleId?: string
  title?: string
} {
  const root = asRecord(value)
  if (!root) return {}
  return {
    app: typeof root.app === 'string' ? root.app : undefined,
    bundleId: typeof root.bundleId === 'string' ? root.bundleId : undefined,
    title: typeof root.title === 'string' ? root.title : undefined,
  }
}

function matchRunningBundleId(
  running: unknown,
  appQuery: string | undefined,
  frontmost: string | undefined,
): string | undefined {
  if (!Array.isArray(running)) return undefined
  const entries = running
    .map(asRecord)
    .filter((entry): entry is Record<string, unknown> => !!entry)
  const lower = appQuery?.trim().toLowerCase()
  if (lower) {
    const byQuery = entries.find((entry) => {
      const app = stringValue(entry.app).toLowerCase()
      const bundleId = stringValue(entry.bundleId).toLowerCase()
      return app === lower || bundleId === lower
    })
    if (typeof byQuery?.bundleId === 'string' && byQuery.bundleId) {
      return byQuery.bundleId
    }
  }
  if (frontmost) {
    const byFront = entries.find(
      (entry) => stringValue(entry.app) === frontmost,
    )
    if (typeof byFront?.bundleId === 'string' && byFront.bundleId) {
      return byFront.bundleId
    }
  }
  return undefined
}

/**
 * Best-effort target app for the leading tool-row icon.
 * - list: never (caller uses Computer Use glyph)
 * - launch/focus: the app being launched/focused — never frontmost
 * - other ops: result root / successorRoot identity
 * - streaming act/query/…: fall back to stateId cache or last Computer Use target
 *   so the row shows the app icon instead of the default pointer glyph
 */
export function computerTargetBundleId(
  op: ComputerOp,
  params: Record<string, unknown>,
  info: ComputerResultInfo,
): string | undefined {
  if (op === 'apps') {
    const action = params.action === 'focus' || params.action === 'launch'
      ? params.action
      : 'list'
    if (action === 'list') return undefined
    // Prefer explicit launch/focus result target, then the app argument.
    if (info.bundleId) {
      rememberComputerUseTarget(info, params)
      return info.bundleId
    }
    const appArg = typeof params.app === 'string' ? params.app.trim() : ''
    if (appArg.includes('.')) {
      lastTargetBundleId = appArg
      return appArg
    }
    return undefined
  }
  if (info.bundleId) {
    rememberComputerUseTarget(info, params)
    return info.bundleId
  }
  const stateId =
    typeof params.stateId === 'string' ? params.stateId.trim() : ''
  if (stateId) {
    const cached = stateIdToBundleId.get(stateId)
    if (cached) return cached
  }
  return lastTargetBundleId
}

/** Pull a count from a TOON tabular array header `name[N]{...}:`. */
function toonArrayCount(result: string, name: string): number | undefined {
  const m = result.match(new RegExp(`${name}\\[(\\d+)\\]`))
  return m ? Number(m[1]) : undefined
}

function parseScalarField(result: string, key: string): string | undefined {
  const m = result.match(new RegExp(`(?:^|\\n)${key}:\\s*(.+?)\\s*(?:\\n|$)`))
  if (!m) return undefined
  const v = m[1].trim()
  if (v === 'null' || v === '') return undefined
  // Strip optional TOON quotes
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1)
  }
  return v
}

/** Parse TOON nested `target:\n  app: X\n  bundleId: Y` block. */
function parseToonTarget(raw: string): { app?: string; bundleId?: string } {
  const block = raw.match(
    /(?:^|\n)target:\s*\n((?:[ \t]+.+\n?)*)/,
  )
  if (!block) return {}
  const body = block[1]
  const app = body.match(/(?:^|\n)[ \t]+app:\s*(.+?)(?:\n|$)/)?.[1]?.trim()
  const bundleId = body
    .match(/(?:^|\n)[ \t]+bundleId:\s*(.+?)(?:\n|$)/)?.[1]
    ?.trim()
  const clean = (v?: string) => {
    if (!v || v === 'null') return undefined
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      return v.slice(1, -1)
    }
    return v
  }
  return { app: clean(app), bundleId: clean(bundleId) }
}

function parseAppsResult(
  obj: Record<string, unknown> | null,
  params: Record<string, unknown> | undefined,
  rawResult?: string,
): ComputerResultInfo {
  const action =
    params?.action === 'focus' || params?.action === 'launch'
      ? params.action
      : 'list'
  const appArg = typeof params?.app === 'string' ? params.app : undefined

  // TOON path (no JSON object)
  if (!obj && rawResult) {
    const totalRaw = parseScalarField(rawResult, 'total')
    const appsCount = toonArrayCount(rawResult, 'apps')
    const target = parseToonTarget(rawResult)
    // Launch/focus: only the target app — never frontmost (often SuperOne/Electron).
    if (action === 'launch' || action === 'focus') {
      const bundleId =
        target.bundleId ||
        (appArg?.includes('.') ? appArg : undefined)
      return {
        status: 'ok',
        app: target.app || appArg,
        bundleId,
      }
    }
    // list: no single target identity for the leading icon
    return {
      status: 'ok',
      counts: {
        apps: appsCount,
        total: totalRaw != null ? Number(totalRaw) : undefined,
        running: appsCount,
      },
    }
  }

  if (!obj) return { status: 'neutral' }

  const target = rootIdentity(obj.target)

  if (action === 'launch' || action === 'focus') {
    return {
      status: 'ok',
      app: target.app || appArg,
      bundleId:
        target.bundleId ||
        (appArg?.includes('.') ? appArg : undefined),
    }
  }

  // New catalog shape (list)
  if (Array.isArray(obj.apps)) {
    const apps = obj.apps
      .map(asRecord)
      .filter((e): e is Record<string, unknown> => !!e)
    return {
      status: 'ok',
      counts: {
        apps: apps.length,
        total: typeof obj.total === 'number' ? obj.total : apps.length,
        running: apps.filter((e) => e.running === true).length,
        roots: Array.isArray(obj.roots) ? obj.roots.length : undefined,
      },
    }
  }

  // Legacy snapshot shape (granted/running/roots)
  return {
    status: 'ok',
    counts: {
      granted: Array.isArray(obj.granted) ? obj.granted.length : undefined,
      running: Array.isArray(obj.running) ? obj.running.length : undefined,
      roots: Array.isArray(obj.roots) ? obj.roots.length : undefined,
    },
  }
}

export function parseComputerResult(
  op: ComputerOp,
  result: string | undefined,
  isError: boolean,
  params?: Record<string, unknown>,
): ComputerResultInfo {
  if (isError) return { status: 'error', errorText: cleanError(result) }
  if (!result) return { status: 'neutral' }

  let data: unknown
  let parsedJson = false
  try {
    data = JSON.parse(result)
    parsedJson = true
  } catch {
    data = undefined
  }

  // computer_apps returns TOON (not JSON). Fall back to lightweight TOON scrape.
  if (!parsedJson) {
    if (op === 'apps') {
      const appsInfo = parseAppsResult(null, params, result)
      rememberComputerUseTarget(appsInfo, params)
      return appsInfo
    }
    // Huge act diffs can truncate mid-JSON in some transports; still recover icon.
    const scraped = scrapeBundleId(result)
    if (scraped) {
      const info: ComputerResultInfo = { status: 'neutral', bundleId: scraped }
      rememberComputerUseTarget(info, params)
      return info
    }
    return { status: 'neutral' }
  }

  const obj = asRecord(data)
  if (!obj) return { status: 'neutral' }
  if (obj.error != null) {
    return {
      status: 'error',
      errorText:
        typeof obj.message === 'string' ? obj.message : stringValue(obj.error),
    }
  }

  let info: ComputerResultInfo

  if (op === 'apps') {
    info = parseAppsResult(obj, params)
  } else if (op === 'snapshot') {
    const root = rootIdentity(obj.root)
    info = {
      status: 'ok',
      imagePath: imagePath(obj.image),
      app: root.app,
      bundleId: root.bundleId,
      title: root.title,
      stateId: typeof obj.stateId === 'string' ? obj.stateId : undefined,
    }
  } else if (op === 'zoom') {
    const root = rootIdentity(obj.root)
    info = {
      status: 'ok',
      imagePath: imagePath(obj.image),
      app: root.app,
      bundleId: root.bundleId,
      title: root.title,
      stateId: typeof obj.stateId === 'string' ? obj.stateId : undefined,
    }
  } else if (op === 'query') {
    const root = rootIdentity(obj.root)
    info = {
      status: 'ok',
      app: root.app,
      bundleId: root.bundleId,
      title: root.title,
      counts: {
        matches: Array.isArray(obj.matches) ? obj.matches.length : undefined,
      },
    }
  } else if (op === 'act') {
    const root = rootIdentity(obj.successorRoot)
    const outcome =
      obj.outcome === 'worked' ||
      obj.outcome === 'didnt' ||
      obj.outcome === 'unknown'
        ? obj.outcome
        : undefined
    info = {
      status: 'ok',
      outcome,
      imagePath: imagePath(obj.successorImage),
      app: root.app,
      bundleId: root.bundleId ?? scrapeBundleId(result),
      title: root.title,
      stateId:
        typeof obj.successorStateId === 'string'
          ? obj.successorStateId
          : undefined,
      counts: {
        evidence: Array.isArray(obj.evidence) ? obj.evidence.length : undefined,
      },
    }
  } else {
    const waitStatus =
      obj.status === 'preexisting' ||
      obj.status === 'verified' ||
      obj.status === 'failed'
        ? obj.status
        : undefined
    const root = rootIdentity(obj.successorRoot ?? obj.root)
    info = {
      status: 'ok',
      waitStatus,
      app: root.app,
      bundleId: root.bundleId,
      title: root.title,
      stateId:
        typeof obj.successorStateId === 'string'
          ? obj.successorStateId
          : undefined,
    }
  }

  rememberComputerUseTarget(info, params)
  return info
}

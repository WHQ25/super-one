/**
 * Header and summary derivation for the `device_*` touch-device tools.
 *
 * Kept apart from the block so the string decisions — which verb, which fragment,
 * what gets masked — are testable without mounting React, and so the block stays
 * chrome only.
 */

export type DeviceOp = 'snapshot' | 'query' | 'act' | 'wait_for'

const DEVICE_OPS = new Set<DeviceOp>(['snapshot', 'query', 'act', 'wait_for'])

export type DeviceActOutcome = 'worked' | 'didnt' | 'unknown'
export type DeviceWaitStatus = 'preexisting' | 'verified' | 'timeout'
export type DeviceOrientation =
  | 'portrait'
  | 'landscape-left'
  | 'portrait-upside-down'
  | 'landscape-right'

export interface DeviceResultInfo {
  status: 'ok' | 'error' | 'neutral'
  errorText?: string
  /** Only `mode=visual|fused` returns one; the row shows a thumbnail affordance. */
  imagePath?: string
  device?: string
  orientation?: DeviceOrientation
  outcome?: DeviceActOutcome
  /** Why the outcome was judged that way — the one line worth surfacing on `didnt`. */
  reason?: string
  /** Set when the backend refused the input outright, rather than it not landing. */
  failure?: string
  waitStatus?: DeviceWaitStatus
  waitedMs?: number
  matches?: number
  /** False when the screen was still animating, so the geometry is approximate. */
  settled?: boolean
  truncated?: boolean
}

export function getDeviceOp(mcpToolName: string): DeviceOp | null {
  if (!mcpToolName.startsWith('device_')) return null
  const bare = mcpToolName.slice('device_'.length) as DeviceOp
  return DEVICE_OPS.has(bare) ? bare : null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function stringValue(value: unknown): string {
  return value == null ? '' : String(value)
}

function truncate(text: string, max = 40): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized
}

/** Typed text can be a password. Never put it in the transcript header. */
const MASK = '••••••'

function formatPoint(x: unknown, y: unknown): string {
  if (typeof x !== 'number' || typeof y !== 'number') return ''
  return `(${x.toFixed(2)}, ${y.toFixed(2)})`
}

function actionTarget(action: Record<string, unknown>): string {
  const ref = stringValue(action.ref)
  return ref || formatPoint(action.x, action.y)
}

/**
 * The single action verb the header uses, as an i18n key fragment.
 *
 * A batch collapses to the generic `act` rather than naming its first action: a row
 * that says "Tapped" for a tap-then-type batch is worse than one that says nothing,
 * because the user stops reading after the verb.
 */
export function deviceVerbKey(
  op: DeviceOp,
  params: Record<string, unknown>,
  streaming = false,
): string {
  if (op === 'query') {
    const queryOp = params.op === 'search' || params.op === 'inspect' ? params.op : 'query'
    return streaming
      ? queryOp === 'search' ? 'searching' : queryOp === 'inspect' ? 'inspecting' : 'querying'
      : queryOp
  }

  if (op === 'act') {
    const actions = Array.isArray(params.actions) ? params.actions : []
    const only = actions.length === 1 ? asRecord(actions[0]) : null
    const base = only ? actVerbBase(stringValue(only.type), only) : 'act'
    return streaming ? ACT_STREAMING[base] ?? 'acting' : base
  }

  const keys: Record<'snapshot' | 'wait_for', [string, string]> = {
    snapshot: ['snapshot', 'snapshotting'],
    wait_for: ['waitFor', 'waitingFor'],
  }
  return keys[op][streaming ? 1 : 0]
}

/**
 * `keyboard` reads as two different actions to a human — plugging the hardware
 * keyboard in, or unplugging it to raise the on-screen one — so it splits by flag
 * rather than sharing one meaningless "Keyboard" verb.
 */
function actVerbBase(type: string, action: Record<string, unknown>): string {
  if (type === 'keyboard') return action.connected === false ? 'showKeyboard' : 'hideKeyboard'
  const known = new Set([
    'tap', 'doubleTap', 'longPress', 'swipe', 'pinch', 'press', 'type', 'rotate',
  ])
  if (known.has(type)) return type
  if (type === 'key') return 'pressKey'
  return 'act'
}

const ACT_STREAMING: Record<string, string> = {
  tap: 'tapping',
  doubleTap: 'doubleTapping',
  longPress: 'longPressing',
  swipe: 'swiping',
  pinch: 'pinching',
  press: 'pressing',
  type: 'typing',
  pressKey: 'pressingKey',
  rotate: 'rotating',
  showKeyboard: 'showingKeyboard',
  hideKeyboard: 'hidingKeyboard',
  act: 'acting',
}

function formatAction(value: unknown): string {
  const action = asRecord(value)
  if (!action) return ''
  const type = stringValue(action.type)
  switch (type) {
    case 'tap':
    case 'doubleTap':
    case 'longPress':
    case 'press':
      return actionTarget(action)
    case 'swipe': {
      const from = actionTarget(action)
      const to = typeof action.direction === 'string'
        ? action.direction
        : formatPoint(action.toX, action.toY)
      return [from, to].filter(Boolean).join(' → ')
    }
    case 'pinch':
      return typeof action.scale === 'number' ? `×${action.scale}` : actionTarget(action)
    case 'type':
      return MASK
    case 'key':
      return stringValue(action.button)
    case 'rotate':
      return stringValue(action.orientation)
    case 'keyboard':
      return ''
    default:
      return actionTarget(action)
  }
}

export function formatDeviceCondition(value: unknown): string {
  const condition = asRecord(value)
  if (!condition) return ''
  // Identifier over label: it is what the agent was told to target, and it stays
  // stable across translations, so it is also the more useful thing to show.
  const target = stringValue(condition.identifier) || stringValue(condition.label)
    || stringValue(condition.ref)
  const text = truncate(stringValue(condition.text), 32)
  switch (condition.kind) {
    case 'exists':
      return target
    case 'notExists':
      return target ? `!${target}` : ''
    case 'textEquals':
      return [target, text && `= “${text}”`].filter(Boolean).join(' ')
    case 'textContains':
      return [target, text && `~ “${text}”`].filter(Boolean).join(' ')
    default:
      return target
  }
}

/**
 * Machine-side fragment for the header, used only when the agent omitted the
 * human-facing `description` the schema asks for.
 */
export function deviceInputSummary(op: DeviceOp, params: Record<string, unknown>): string {
  switch (op) {
    case 'snapshot':
      return params.mode != null && params.mode !== 'semantic' ? stringValue(params.mode) : ''
    case 'query': {
      if (params.op === 'search') {
        const text = truncate(stringValue(params.text))
        return text ? `“${text}”` : ''
      }
      return stringValue(params.ref)
    }
    case 'act': {
      const actions = Array.isArray(params.actions) ? params.actions : []
      const first = actions.length > 0 ? formatAction(actions[0]) : ''
      const remaining = actions.length > 1 ? `+${actions.length - 1}` : ''
      return [first, remaining].filter(Boolean).join(' · ')
    }
    case 'wait_for':
      return formatDeviceCondition(params.condition)
  }
}

function cleanError(result: string | undefined): string | undefined {
  if (!result) return undefined
  // `[Error] CODE: message` — the code is for the agent, the message is for the user.
  const text = result
    .replace(/^\[Error\]\s*/, '')
    .replace(/^[A-Z_]+:\s*/, '')
    .replace(/<\/?tool_use_error>/g, '')
    .trim()
  return text || undefined
}

function orientationOf(value: unknown): DeviceOrientation | undefined {
  return value === 'portrait' || value === 'landscape-left'
    || value === 'portrait-upside-down' || value === 'landscape-right'
    ? value
    : undefined
}

/**
 * Parse one `device_*` result into what the row needs.
 *
 * Total by construction: the result may be JSON, an `[Error] …` string, or a
 * truncated fragment, and a block that throws takes the whole message down with it.
 */
export function parseDeviceResult(
  op: DeviceOp,
  result: string | undefined,
  isError: boolean,
): DeviceResultInfo {
  if (isError) return { status: 'error', errorText: cleanError(result) }
  if (!result) return { status: 'neutral' }

  let parsed: unknown
  try {
    parsed = JSON.parse(result)
  } catch {
    return { status: 'neutral' }
  }
  const obj = asRecord(parsed)
  if (!obj) return { status: 'neutral' }

  const common: DeviceResultInfo = {
    status: 'ok',
    ...(orientationOf(obj.orientation) ? { orientation: orientationOf(obj.orientation)! } : {}),
    ...(obj.settled === false ? { settled: false } : {}),
    ...(obj.truncated === true ? { truncated: true } : {}),
  }

  if (op === 'snapshot') {
    const image = asRecord(obj.image)
    return {
      ...common,
      ...(typeof obj.device === 'string' ? { device: obj.device } : {}),
      ...(typeof image?.path === 'string' && image.path ? { imagePath: image.path } : {}),
    }
  }

  if (op === 'query') {
    return {
      ...common,
      ...(typeof obj.matches === 'number' ? { matches: obj.matches } : {}),
    }
  }

  if (op === 'act') {
    const outcome = obj.outcome === 'worked' || obj.outcome === 'didnt' || obj.outcome === 'unknown'
      ? obj.outcome
      : undefined
    return {
      ...common,
      ...(outcome ? { outcome } : {}),
      ...(typeof obj.reason === 'string' ? { reason: obj.reason } : {}),
      ...(typeof obj.failure === 'string' ? { failure: obj.failure } : {}),
    }
  }

  const waitStatus = obj.status === 'preexisting' || obj.status === 'verified' || obj.status === 'timeout'
    ? obj.status
    : undefined
  return {
    ...common,
    ...(waitStatus ? { waitStatus } : {}),
    ...(typeof obj.waitedMs === 'number' ? { waitedMs: obj.waitedMs } : {}),
  }
}

/**
 * Whether the row should read as something needing attention.
 *
 * `didnt` and `timeout` are successful tool calls that report a failed intent — not
 * errors, but the user should not have to expand the row to notice them.
 */
export function deviceNeedsAttention(info: DeviceResultInfo): boolean {
  return info.outcome === 'didnt' || info.waitStatus === 'timeout'
}

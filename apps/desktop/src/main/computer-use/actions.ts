import { DEFAULT_MAX_ACTIONS, ComputerUseError, type UiAction } from './types'

/** Parse and validate a raw action list from tool args. */
export function parseActions(raw: unknown): UiAction[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new ComputerUseError('INVALID_ACTION', 'actions must be a non-empty array')
  }
  if (raw.length > DEFAULT_MAX_ACTIONS) {
    throw new ComputerUseError(
      'INVALID_ACTION',
      `actions exceeds max of ${DEFAULT_MAX_ACTIONS}`,
      { count: raw.length },
    )
  }
  return raw.map((item, i) => parseOne(item, i))
}

function parseOne(item: unknown, index: number): UiAction {
  if (!item || typeof item !== 'object') {
    throw new ComputerUseError('INVALID_ACTION', `actions[${index}] must be an object`)
  }
  const a = item as Record<string, unknown>
  const type = a.type
  if (typeof type !== 'string') {
    throw new ComputerUseError('INVALID_ACTION', `actions[${index}].type is required`)
  }
  switch (type) {
    case 'press':
      return { type: 'press', ref: reqString(a, 'ref', index) }
    case 'click':
      return {
        type: 'click',
        ref: optString(a, 'ref'),
        x: optNumber(a, 'x'),
        y: optNumber(a, 'y'),
        button: a.button === 'right' ? 'right' : a.button === 'left' ? 'left' : undefined,
      }
    case 'setText':
      return {
        type: 'setText',
        ref: reqString(a, 'ref', index),
        text: reqString(a, 'text', index),
      }
    case 'typeText':
      return {
        type: 'typeText',
        ref: optString(a, 'ref'),
        text: reqString(a, 'text', index),
      }
    case 'keypress': {
      if (!Array.isArray(a.keys) || a.keys.some((k) => typeof k !== 'string')) {
        throw new ComputerUseError('INVALID_ACTION', `actions[${index}].keys must be string[]`)
      }
      return { type: 'keypress', keys: a.keys as string[] }
    }
    case 'scroll':
      return {
        type: 'scroll',
        ref: optString(a, 'ref'),
        dx: optNumber(a, 'dx'),
        dy: optNumber(a, 'dy'),
      }
    case 'drag': {
      if (!Array.isArray(a.path) || a.path.length < 2) {
        throw new ComputerUseError('INVALID_ACTION', `actions[${index}].path needs ≥2 points`)
      }
      const path = a.path.map((p, j) => {
        if (!p || typeof p !== 'object') {
          throw new ComputerUseError('INVALID_ACTION', `actions[${index}].path[${j}] invalid`)
        }
        const pt = p as Record<string, unknown>
        if (typeof pt.x !== 'number' || typeof pt.y !== 'number') {
          throw new ComputerUseError('INVALID_ACTION', `actions[${index}].path[${j}] needs x,y`)
        }
        return { x: pt.x, y: pt.y }
      })
      return { type: 'drag', path }
    }
    case 'moveMouse':
      return {
        type: 'moveMouse',
        x: reqNumber(a, 'x', index),
        y: reqNumber(a, 'y', index),
      }
    default:
      throw new ComputerUseError(
        'INVALID_ACTION',
        `actions[${index}].type unsupported: ${type}`,
      )
  }
}

function reqString(a: Record<string, unknown>, key: string, index: number): string {
  const v = a[key]
  if (typeof v !== 'string' || !v) {
    throw new ComputerUseError('INVALID_ACTION', `actions[${index}].${key} must be a non-empty string`)
  }
  return v
}

function optString(a: Record<string, unknown>, key: string): string | undefined {
  const v = a[key]
  return typeof v === 'string' ? v : undefined
}

function reqNumber(a: Record<string, unknown>, key: string, index: number): number {
  const v = a[key]
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new ComputerUseError('INVALID_ACTION', `actions[${index}].${key} must be a number`)
  }
  return v
}

function optNumber(a: Record<string, unknown>, key: string): number | undefined {
  const v = a[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

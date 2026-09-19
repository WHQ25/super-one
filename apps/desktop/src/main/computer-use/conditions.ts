import { z } from 'zod'
import { ComputerUseError, type Condition } from './types'

export const conditionSchema = z.object({
  kind: z.enum(['exists', 'notExists', 'textEquals', 'textContains', 'valueEquals', 'newRoot']),
  ref: z.string().optional().describe('Required except for newRoot: the target element ref from the starting snapshot.'),
  text: z.string().optional().describe('For textEquals/textContains: element name or value. For newRoot: substring in the new root outline.'),
  value: z.string().optional().describe('Required for valueEquals: the exact element value to wait for.'),
  title: z.string().optional().describe('newRoot: exact title of a visible window, panel, sheet or menu in the same app that was absent at the starting snapshot.'),
  rootKind: z.enum(['window', 'sheet', 'dialog', 'menu', 'popover']).optional().describe('newRoot: optional kind filter. Supply title and/or text; all supplied filters must match.'),
})

export function parseCondition(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const kind = c.kind
  if (kind === 'newRoot') {
    if (!(typeof c.title === 'string' && c.title.trim()) && !(typeof c.text === 'string' && c.text.trim())) {
      throw new ComputerUseError('INVALID_ACTION', 'newRoot requires a non-empty title or text')
    }
    if ((c.title !== undefined && typeof c.title !== 'string') || (c.text !== undefined && typeof c.text !== 'string')
      || (c.rootKind !== undefined && !['window', 'sheet', 'dialog', 'menu', 'popover'].includes(String(c.rootKind)))) {
      throw new ComputerUseError('INVALID_ACTION', 'Invalid newRoot title, text or rootKind')
    }
    return { kind, ...(c.title ? { title: c.title as string } : {}), ...(c.text ? { text: c.text as string } : {}),
      ...(c.rootKind ? { rootKind: c.rootKind as Extract<Condition, { kind: 'newRoot' }>['rootKind'] } : {}) }
  }
  if (kind === 'exists' || kind === 'notExists') {
    if (typeof c.ref !== 'string') throw new ComputerUseError('INVALID_ACTION', 'condition.ref required')
    return { kind, ref: c.ref }
  }
  if (kind === 'textEquals' || kind === 'textContains') {
    if (typeof c.ref !== 'string' || typeof c.text !== 'string') {
      throw new ComputerUseError('INVALID_ACTION', 'condition.ref and text required')
    }
    return { kind, ref: c.ref, text: c.text }
  }
  if (kind === 'valueEquals') {
    if (typeof c.ref !== 'string' || typeof c.value !== 'string') {
      throw new ComputerUseError('INVALID_ACTION', 'condition.ref and value required')
    }
    return { kind, ref: c.ref, value: c.value }
  }
  throw new ComputerUseError('INVALID_ACTION', `unknown condition.kind: ${String(kind)}`)
}

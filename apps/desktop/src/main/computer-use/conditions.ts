import { z } from 'zod'
import { ComputerUseError, type Condition } from './types'

export const conditionSchema = z.object({
  kind: z.enum(['exists', 'notExists', 'textEquals', 'textContains', 'valueEquals']),
  ref: z.string().optional().describe('Required for every kind: the target element ref from the starting snapshot.'),
  text: z.string().optional().describe('Required for textEquals/textContains: compare against the element name or value.'),
  value: z.string().optional().describe('Required for valueEquals: the exact element value to wait for.'),
})

export function parseCondition(raw: unknown): Condition | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const c = raw as Record<string, unknown>
  const kind = c.kind
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

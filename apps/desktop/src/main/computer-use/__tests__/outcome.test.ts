import { describe, expect, it } from 'vitest'
import {
  deriveOutcomeFromSteps,
  diffIndicatesEffect,
  refineActOutcome,
} from '../outcome'
import type { StateDiff, UiOutlineNode } from '../types'

const emptyDiff = (): StateDiff => ({
  added: [],
  removed: [],
  changed: [],
  fullViewFallback: false,
})

const leaf = (ref: string, value?: string): UiOutlineNode => ({
  ref,
  role: 'staticText',
  value,
  pictureOnly: false,
})

describe('deriveOutcomeFromSteps', () => {
  it('returns didnt for empty or fully failed steps', () => {
    expect(deriveOutcomeFromSteps([])).toBe('didnt')
    expect(deriveOutcomeFromSteps([{ applied: false }])).toBe('didnt')
    expect(
      deriveOutcomeFromSteps([{ applied: true, confirmedNoEffect: true }]),
    ).toBe('didnt')
  })

  it('returns unknown when any step is applied but unverified', () => {
    expect(
      deriveOutcomeFromSteps([{ applied: true, unknown: true }]),
    ).toBe('unknown')
  })

  it('returns worked when every step is applied and verified', () => {
    expect(
      deriveOutcomeFromSteps([
        { applied: true, unknown: false },
        { applied: true },
      ]),
    ).toBe('worked')
  })
})

describe('diffIndicatesEffect', () => {
  it('rejects ambient single-field churn', () => {
    expect(
      diffIndicatesEffect({
        ...emptyDiff(),
        changed: [{ ref: '@e1', field: 'value', from: '31°', to: '32°' }],
      }),
    ).toBe(false)
  })

  it('accepts multi-node structural navigation', () => {
    expect(
      diffIndicatesEffect({
        ...emptyDiff(),
        removed: ['@e10', '@e11', '@e12'],
        added: [],
      }),
    ).toBe(true)
  })

  it('accepts fullViewFallback topology rewrites', () => {
    expect(
      diffIndicatesEffect({
        ...emptyDiff(),
        fullViewFallback: true,
      }),
    ).toBe(true)
  })

  it('accepts many label swaps on stable refs', () => {
    const changed = Array.from({ length: 8 }, (_, i) => ({
      ref: `@e${i}`,
      field: 'value',
      from: 'a',
      to: 'b',
    }))
    expect(diffIndicatesEffect({ ...emptyDiff(), changed })).toBe(true)
  })
})

describe('refineActOutcome', () => {
  it('promotes unknown AX press to worked when successor tree rewrites', () => {
    // Mirrors iQIYI "历史": control value stays "历史", but outline loses many nodes.
    const outcome = refineActOutcome({
      steps: [
        {
          applied: true,
          unknown: true,
          // before/after value both "历史" → step stays unknown
        },
      ],
      actions: [{ type: 'press', ref: '@e32' }],
      successorOutline: {
        ref: '@e1',
        role: 'window',
        children: [leaf('@e70', '观看历史'), leaf('@e88', '清空历史')],
      },
      diff: {
        added: [],
        removed: Array.from({ length: 50 }, (_, i) => `@e${200 + i}`),
        changed: [
          { ref: '@e70', field: 'value', to: '观看历史' },
          { ref: '@e88', field: 'value', to: '清空历史' },
        ],
        fullViewFallback: false,
      },
    })
    expect(outcome).toBe('worked')
  })

  it('keeps unknown when applied but successor outline is effectively unchanged', () => {
    const outcome = refineActOutcome({
      steps: [{ applied: true, unknown: true }],
      actions: [{ type: 'press', ref: '@e1' }],
      successorOutline: leaf('@e1', '历史'),
      diff: emptyDiff(),
    })
    expect(outcome).toBe('unknown')
  })

  it('does not promote didnt via a large diff', () => {
    const outcome = refineActOutcome({
      steps: [{ applied: false }],
      actions: [{ type: 'press', ref: '@e1' }],
      successorOutline: leaf('@e1'),
      diff: {
        ...emptyDiff(),
        removed: ['@e1', '@e2', '@e3', '@e4'],
      },
    })
    expect(outcome).toBe('didnt')
  })

  it('promotes setText when typed text appears in the successor outline', () => {
    const outcome = refineActOutcome({
      steps: [{ applied: true, unknown: true }],
      actions: [{ type: 'setText', ref: '@e3', text: 'hello-world' }],
      successorOutline: leaf('@e3', 'hello-world'),
      diff: emptyDiff(),
    })
    expect(outcome).toBe('worked')
  })

  it('honors failed expect over a large diff', () => {
    const outcome = refineActOutcome({
      steps: [{ applied: true, unknown: true }],
      actions: [{ type: 'press', ref: '@e1' }],
      successorOutline: leaf('@e1'),
      diff: {
        ...emptyDiff(),
        removed: ['@e1', '@e2', '@e3'],
      },
      expectHolds: false,
    })
    expect(outcome).toBe('didnt')
  })

  it('honors successful expect when steps are unknown', () => {
    const outcome = refineActOutcome({
      steps: [{ applied: true, unknown: true }],
      actions: [{ type: 'press', ref: '@e1' }],
      successorOutline: leaf('@e1'),
      diff: emptyDiff(),
      expectHolds: true,
    })
    expect(outcome).toBe('worked')
  })
})

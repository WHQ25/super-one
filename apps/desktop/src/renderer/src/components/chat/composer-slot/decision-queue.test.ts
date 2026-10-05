import { describe, expect, it } from 'vitest'
import { buildDecisionQueue } from './decision-queue'

describe('buildDecisionQueue', () => {
  it('keeps permissions in arrival order, followed by the question', () => {
    const queue = buildDecisionQueue(
      [
        { requestId: 'permission-1', toolName: 'Read', input: {}, allowAlwaysAllow: false },
        { requestId: 'permission-2', toolName: 'Bash', input: {}, allowAlwaysAllow: false },
      ],
      { requestId: 'question-1', questions: [] },
    )

    expect(queue.map(({ kind, request }) => `${kind}:${request.requestId}`)).toEqual([
      'permission:permission-1',
      'permission:permission-2',
      'question:question-1',
    ])
  })

  it('returns an empty queue when no decision is pending', () => {
    expect(buildDecisionQueue([], null)).toEqual([])
  })

})

import { describe, expect, it } from 'vitest'
import { subagentRunState } from './subagent-run-state'

describe('subagentRunState', () => {
  it('keeps a tracked task running past its launch receipt and the end of the turn', () => {
    expect(subagentRunState({ tracked: true, finished: false, hasResult: true, isStreaming: false }))
      .toEqual({ isRunning: true, isComplete: false })
  })

  it('completes a tracked task only on its notification', () => {
    expect(subagentRunState({ tracked: true, finished: true, hasResult: true, isStreaming: true }))
      .toEqual({ isRunning: false, isComplete: true })
  })

  it('follows the tool call for an untracked card', () => {
    expect(subagentRunState({ tracked: false, finished: false, hasResult: false, isStreaming: true }))
      .toEqual({ isRunning: true, isComplete: false })
    expect(subagentRunState({ tracked: false, finished: false, hasResult: false, isStreaming: false }))
      .toEqual({ isRunning: false, isComplete: false })
    expect(subagentRunState({ tracked: false, finished: false, hasResult: true, isStreaming: true }))
      .toEqual({ isRunning: false, isComplete: true })
  })
})

import { describe, expect, it } from 'vitest'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurn, replayCodexRecordedTurnWithItems } from './recordings'

describe('recorded Codex turns', () => {
  it.each(CODEX_RECORDINGS)('%s replays every turn to a terminal event', (name) => {
    const recording = readCodexRecording(name)
    recording.turns.forEach((turn, index) => {
      const events = replayCodexRecordedTurn(recording, index)
      const terminal = events.findLast(event => event.type === 'message_complete' || event.type === 'message_interrupted' || event.type === 'message_error')
      expect(terminal?.type).toBe(turn.outcome === 'completed' ? 'message_complete' : 'message_interrupted')
    })
  })

  it('covers the item kinds the unified turn view translates', () => {
    const kinds = (name: typeof CODEX_RECORDINGS[number]) => new Set(readCodexRecording(name).turns.flatMap((_, index) =>
      replayCodexRecordedTurnWithItems(readCodexRecording(name), index).items.map(item => item.type)))
    expect(kinds('commands')).toContain('command_execution')
    expect(kinds('file-change')).toContain('file_change')
    expect(kinds('mcp-app')).toContain('mcp_tool_call')
    expect(kinds('web-search')).toContain('web_search')
    expect([...kinds('plan-mode')]).toEqual(expect.arrayContaining(['plan', 'reasoning']))
    expect(kinds('review')).toContain('review')
    expect(kinds('collab')).toContain('collab_tool_call')
  })

  it('keeps a non-zero exit as a completed-with-exit-code command', () => {
    const recording = readCodexRecording('commands')
    const exit = replayCodexRecordedTurnWithItems(recording, 0).items.find(item => item.type === 'command_execution' && item.exitCode === 3)
    expect(exit).toMatchObject({ status: 'failed', exitCode: 3 })
  })
})

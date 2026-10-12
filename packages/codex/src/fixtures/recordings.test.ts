import { describe, expect, it } from 'vitest'
import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { CODEX_RECORDINGS, readCodexRecording, replayCodexRecordedTurn } from './recordings'

function finalItems(events: AgentEvent[]): CodexThreadItem[] {
  const byId = new Map<string, CodexThreadItem>()
  for (const event of events) if (event.type === 'codex_item_delta') byId.set(event.item.id, event.item)
  return [...byId.values()]
}

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
      finalItems(replayCodexRecordedTurn(readCodexRecording(name), index)).map(item => item.type)))
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
    const exit = finalItems(replayCodexRecordedTurn(recording, 0)).find(item => item.type === 'command_execution' && item.exitCode === 3)
    expect(exit).toMatchObject({ status: 'failed', exitCode: 3 })
  })
})

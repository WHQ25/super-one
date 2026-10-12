/**
 * Real Codex app-server turns recorded by `scripts/record-turns.ts`, replayed
 * through the package mapper. Raw notifications are the fixture, so every
 * producer (this mapper, the desktop turn) can be tested against the same wire.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentEvent, CodexThreadItem } from '@superone/shared/agent-types'
import { createCodexAgentEventMapper, type CodexAppServerNotification } from '../agent-event-mapper'

export const CODEX_RECORDINGS = [
  'collab', 'commands', 'compact', 'file-change', 'interrupt', 'mcp-app',
  'plan-mode', 'review', 'steer', 'todo', 'web-search',
] as const
export type CodexRecordingName = typeof CODEX_RECORDINGS[number]

export interface CodexRecordedTurn {
  turn: { prompt?: string; turnKind?: 'run' | 'steer' | 'review' | 'compact' }
  notifications: CodexAppServerNotification[]
  /** `completed`, or the error the turn runner threw (`Codex turn interrupted`). */
  outcome: string
}

export interface CodexRecording {
  scenario: CodexRecordingName
  codexVersion: string
  model: string
  turns: CodexRecordedTurn[]
}

export function readCodexRecording(name: CodexRecordingName): CodexRecording {
  return JSON.parse(readFileSync(join(import.meta.dirname, 'recordings', `${name}.json`), 'utf8')) as CodexRecording
}

/** The recording's root thread: the first `thread/started` of the scenario. */
export function recordedThreadId(recording: CodexRecording): string | null {
  for (const turn of recording.turns) {
    const started = turn.notifications.find(note => note.method === 'thread/started')
    const id = (started?.params.thread as { id?: string } | undefined)?.id
    if (id) return id
  }
  return null
}

/** Replay one recorded turn through the package mapper, as the CLI node does. */
export function replayCodexRecordedTurn(recording: CodexRecording, index: number, messageId = `${recording.scenario}-${index}`): AgentEvent[] {
  return replayCodexRecordedTurnWithItems(recording, index, messageId).events
}

/** The replayed events and the mapper's final items, which the events carry only as content. */
export function replayCodexRecordedTurnWithItems(recording: CodexRecording, index: number, messageId = `${recording.scenario}-${index}`): { events: AgentEvent[]; items: CodexThreadItem[] } {
  const events: AgentEvent[] = []
  const turn = recording.turns[index]!
  let clock = 1_000
  const mapper = createCodexAgentEventMapper({
    messageId,
    emit: event => events.push(event),
    model: recording.model,
    turnKind: turn.turn.turnKind,
    now: () => clock++,
  })
  mapper.start(recordedThreadId(recording))
  for (const note of turn.notifications) mapper.apply(note)
  if (turn.outcome !== 'completed') mapper.fail(turn.outcome, /interrupt/i.test(turn.outcome))
  return { events, items: mapper.items() }
}

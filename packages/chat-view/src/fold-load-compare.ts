import type { ChatMessage } from '@superone/shared/agent-types'
import { planProcessFolds } from '@superone/chat-core/turn-process/process-folds'
import { utf8Length } from '@superone/shared/transcript-window/content-digest'
import { foldMessageFragments } from '@superone/shared/transcript-window/folds'
import { MessageFragmenter } from '@superone/shared/transcript-window/fragment-message'
import { selectTranscriptWindow, windowBudget, type TranscriptWindowBudget } from '@superone/shared/transcript-window/select-window'
import { applyWindowResult, EMPTY_WINDOW_LOOKUP, materializeWindowMessage } from '@superone/shared/transcript-window/window-store'
import { textMessage } from '@superone/shared/transcript-window/window-fixtures'

/**
 * Cold open of a phone transcript window (390×844). The same budget
 * `restoreWindowSession` sends when the phone reports that viewport.
 */
export const PHONE_VIEWPORT = { width: 390, height: 844 } as const

/**
 * Six settled turns whose tool output is large enough that an unfolded
 * window spends the phone byte budget on the last turn. The shared fixture
 * uses one-line results, which hit the fragment cap first and hide the
 * difference fold is for.
 */
export const FOLD_LOAD_SCENARIO = { turns: 6, tools: 40, outputChars: 12_000 } as const

export const NETWORK_PRESETS = [
  { id: 'slow-3g', label: '慢 3G', kilobitsPerSecond: 400, latencyMs: 400 },
  { id: 'fast-3g', label: '快 3G', kilobitsPerSecond: 1_600, latencyMs: 150 },
  { id: '4g', label: '4G', kilobitsPerSecond: 9_000, latencyMs: 60 },
  { id: 'wifi', label: 'Wi-Fi', kilobitsPerSecond: 30_000, latencyMs: 20 },
] as const

const MIN_KBPS = 50
const MAX_KBPS = 100_000

export interface ScreenLoad {
  /** UTF-8 JSON of the window messages, the phone's `historyBytes`. */
  bytes: number
  messages: number
  fragments: number
  folds: number
  /** Older transcript remains past this window. */
  older: boolean
  /** The tail reply is inside the window. */
  reply: boolean
  /** What the phone paints for this window. */
  rows: ChatMessage[]
}

export interface FoldLoadComparison {
  budget: TranscriptWindowBudget
  turns: number
  tools: number
  outputChars: number
  /** Whole transcript, which neither window sends. */
  transcriptBytes: number
  plain: ScreenLoad
  folded: ScreenLoad
}

/** Downlink time for `bytes` at `kilobitsPerSecond`. Infinite when the rate is not positive. */
export function transferMs(bytes: number, kilobitsPerSecond: number): number {
  if (!(kilobitsPerSecond > 0) || !Number.isFinite(kilobitsPerSecond)) return Number.POSITIVE_INFINITY
  return (bytes * 8) / kilobitsPerSecond
}

/** One round trip plus the first window. The open is a single `session.transcriptWindow`. */
export function firstScreenMs(bytes: number, kilobitsPerSecond: number, latencyMs: number): number {
  const latency = Number.isFinite(latencyMs) ? Math.max(0, latencyMs) : 0
  return latency + transferMs(bytes, kilobitsPerSecond)
}

export function kbpsToSlider(kilobitsPerSecond: number): number {
  const kbps = Math.min(MAX_KBPS, Math.max(MIN_KBPS, kilobitsPerSecond))
  const t = (Math.log(kbps) - Math.log(MIN_KBPS)) / (Math.log(MAX_KBPS) - Math.log(MIN_KBPS))
  return Math.round(t * 1000)
}

export function sliderToKbps(slider: number): number {
  const t = Math.min(1, Math.max(0, slider / 1000))
  return Math.round(Math.exp(Math.log(MIN_KBPS) + t * (Math.log(MAX_KBPS) - Math.log(MIN_KBPS))))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const kb = bytes / 1024
  return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.round(ms)} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`
}

export function formatRate(kilobitsPerSecond: number): string {
  if (!(kilobitsPerSecond > 0) || !Number.isFinite(kilobitsPerSecond)) return '—'
  if (kilobitsPerSecond >= 1000) {
    const mbps = kilobitsPerSecond / 1000
    return `${mbps >= 10 ? Math.round(mbps) : mbps.toFixed(1)} Mbps`
  }
  return `${Math.round(kilobitsPerSecond)} kbps`
}

/** First phone window of the heavy session, with process folded or sent in full. */
export function compareFoldLoad(
  scenario: { turns: number; tools: number; outputChars: number } = FOLD_LOAD_SCENARIO,
  budget: TranscriptWindowBudget = windowBudget({ viewport: PHONE_VIEWPORT }),
): FoldLoadComparison {
  const messages = heavySession(scenario)
  return {
    budget,
    turns: scenario.turns,
    tools: scenario.tools,
    outputChars: scenario.outputChars,
    transcriptBytes: utf8Length(JSON.stringify(messages)),
    plain: screenOf(messages, false, budget),
    folded: screenOf(messages, true, budget),
  }
}

function heavySession(scenario: { turns: number; tools: number; outputChars: number }): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (let i = 0; i < scenario.turns; i++) {
    messages.push(textMessage(`u${i}`, 'user', `Turn ${i + 1}: continue the refactor and report what changed.`))
    messages.push(heavyTurn(`a${i}`, scenario.tools, scenario.outputChars))
  }
  return messages
}

function heavyTurn(id: string, tools: number, outputChars: number): ChatMessage {
  const summary = (`line: ${'x'.repeat(70)}\n`).repeat(Math.ceil(outputChars / 80)).slice(0, outputChars)
  return {
    id,
    role: 'assistant',
    status: 'complete',
    createdAt: '2026-10-13T00:00:00.000Z',
    providerId: 'claude',
    content: [
      { type: 'thinking', thinking: 'Planning the change.' },
      ...Array.from({ length: tools }, (_, i) => {
        const toolUseId = `${id}_t${i}`
        return [
          { type: 'tool_use' as const, toolName: 'Bash', toolUseId, status: 'complete' as const, input: JSON.stringify({ command: `npm test -- ${i}` }) },
          { type: 'tool_result' as const, toolUseId, summary },
        ]
      }).flat(),
      { type: 'text', text: `All done: the change is in. (${id})` },
    ],
  }
}

function screenOf(messages: ChatMessage[], folds: boolean, budget: TranscriptWindowBudget): ScreenLoad {
  const fragmenter = new MessageFragmenter()
  const plans = new Map(messages.map((message) => [message.id, planProcessFolds(message)]))
  const selected = selectTranscriptWindow({
    count: messages.length,
    at(index) {
      const message = messages[index]
      const fragments = fragmenter.fragment(message)
      return folds ? foldMessageFragments(fragments, plans.get(message.id)!.ranges) : fragments
    },
    indexOf: (id) => messages.findIndex((message) => message.id === id),
  }, {}, budget)
  const fragments = selected.messages.flatMap((message) => message.fragments)
  const rows = applyWindowResult(null, { ...selected, total: messages.length }, EMPTY_WINDOW_LOOKUP)
    .state.messages.map(materializeWindowMessage)
  return {
    bytes: utf8Length(JSON.stringify(selected.messages)),
    messages: selected.messages.length,
    fragments: fragments.length,
    folds: fragments.filter((fragment) => fragment.body?.kind === 'fold').length,
    older: selected.older !== null,
    reply: fragments.some((fragment) => fragment.body?.kind === 'text' && fragment.body.text.includes('All done')),
    rows,
  }
}

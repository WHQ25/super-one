import type { Locale } from '@superone/shared/agent-types'
import type { ReductionProjection } from './protocol'

const hints = {
  'voice-starting': ['Connecting…', '正在连接…'],
  'voice-ready': ['Listening…', '正在聆听…'],
  'voice-empty': ['Your voice conversation will appear here.', '语音对话记录会显示在这里。'],
  codex: ['Codex messages and work will appear here.', 'Codex 的消息和执行过程会显示在这里。'],
} as const

export function TranscriptEmptyState({ state, locale }: { state: ReductionProjection['emptyState']; locale: Locale }) {
  if (state === 'voice-stopping') return null
  const hint = state ? hints[state][locale === 'zh' ? 1 : 0] : 'Waiting for session…'
  return <p data-testid="transcript-empty" role="status" className="py-12 text-center text-sm text-muted-foreground">{hint}</p>
}

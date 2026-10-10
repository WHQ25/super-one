import type { Locale } from '@superone/shared/agent-types'
import type { ReductionProjection } from './protocol'

const hints = {
  'voice-starting': ['Connecting voice…', '正在连接语音…'],
  'voice-ready': ['Voice connected. You can start speaking.', '语音已接通，可以开始说话。'],
  'voice-stopping': ['Ending voice…', '正在挂断语音…'],
  'voice-empty': ['Your voice conversation will appear here.', '语音对话记录会显示在这里。'],
  codex: ['Codex messages and work will appear here.', 'Codex 的消息和执行过程会显示在这里。'],
} as const

export function TranscriptEmptyState({ state, locale }: { state: ReductionProjection['emptyState']; locale: Locale }) {
  const hint = state ? hints[state][locale === 'zh' ? 1 : 0] : 'Waiting for session…'
  return <p data-testid="transcript-empty" role="status" className="py-12 text-center text-sm text-muted-foreground">{hint}</p>
}

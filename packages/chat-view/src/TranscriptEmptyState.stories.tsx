import { TranscriptEmptyState } from './TranscriptEmptyState'
export default { title: 'Chat/Transcript empty state', component: TranscriptEmptyState, args: { locale: 'zh' },
  render: (props: Parameters<typeof TranscriptEmptyState>[0]) => <div style={{ width: 320 }}><TranscriptEmptyState {...props} /></div> }
export const Connecting = { args: { state: 'voice-starting' } }
export const Connected = { args: { state: 'voice-ready' } }
export const Stopping = { args: { state: 'voice-stopping' } }
export const VoiceHistory = { args: { state: 'voice-empty' } }
export const BackingCodex = { args: { state: 'codex' } }
export const English = { args: { state: 'voice-ready', locale: 'en' } }

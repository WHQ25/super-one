import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useMemo, useRef, useState } from 'react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { realtimeVoiceAudioLevels, resetRealtimeCallForTests, useRealtimeCallStore, type RealtimeCallActivity, type RealtimeCallState } from '@/stores/realtime-call'
import { ComposerVoiceEntry } from './ComposerVoiceEntry'
import { CodexRealtimeTranscript } from './CodexRealtimeTranscript'
import { RealtimeCallComposer } from './RealtimeCallComposer'

const projectPath = '/storybook/voice-composer'
const sessionId = 'voice-composer'

interface PreviewProps {
  state: RealtimeCallState
  activity?: RealtimeCallActivity
  captions?: boolean
  muted?: boolean
  width?: number
  otherSession?: boolean
  paused?: boolean
  interrupted?: boolean
}

function Preview({ state, activity = 'listening', captions = false, muted = false, width = 620, otherSession = false, paused = false, interrupted = false }: PreviewProps) {
  useMemo(() => {
    mockIpc('app', 'getMediaServerPort', async () => 7792)
    mockIpc('app', 'trace', () => {})
    mockIpc('agent', 'loadRealtimeTimeline', async () => null)
    mockIpc('environment', 'sessionSource', async () => null)
  }, [])
  const [ready, setReady] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = useChatStore.getState()
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    Object.assign(session, {
      sessionProvider: 'codex',
    })
    useChatStore.setState({
      activeProject: projectPath,
      projectSessions: { ...previous.projectSessions, [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } } },
    })
    useRealtimeCallStore.setState({
      sessionId,
      projectPath,
      state,
      activity,
      microphoneMuted: muted,
      paused, pauseReason: paused ? interrupted ? 'interrupted' : 'manual' : null, resuming: false,
    })
    realtimeVoiceAudioLevels.publish({ input: activity === 'user-speaking' ? 0.08 : 0, output: activity === 'assistant-speaking' ? 0.12 : 0 })
    if (captions) {
      const store = useCodexRealtimeViewStore.getState()
      store.startTranscriptItem(sessionId, { itemId: 'u', realtimeSessionId: 'rt', role: 'user', text: 'Please check the changes and keep me updated. 请帮我检查改动，并告诉我进展。' })
      store.startTranscriptItem(sessionId, { itemId: 'a', realtimeSessionId: 'rt', role: 'assistant', text: 'I am checking the changes. I will let you know when it is ready. 正在检查这些改动，完成后会告诉你。' })
    }
    setReady(true)
    return () => {
      resetRealtimeCallForTests()
      useCodexRealtimeViewStore.setState({ sessions: {} })
      useChatStore.setState(previous)
    }
  }, [activity, captions, muted, state, paused, interrupted])
  return (
    <div data-testid="voice-ui-preview" className="@container flex max-w-full flex-col bg-card" style={{ width, height: captions ? 420 : undefined }}>
      {ready && <TooltipProvider>
        {captions && <CodexRealtimeTranscript sessionId={sessionId} scrollViewportRef={viewportRef} liquidGlass={false} threadMessages={[]} sessionStatus="idle" needsDecision={false} />}
        <RealtimeCallComposer onPlayback={() => useRealtimeCallStore.setState(current => ({ paused: !current.paused, pauseReason: current.paused ? null : 'manual' }))}
          onStop={() => useRealtimeCallStore.setState({ state: 'stopping' })} />
        {otherSession && <ComposerVoiceEntry harness="codex" projectPath={projectPath} sessionId="new-session" />}
      </TooltipProvider>}
    </div>
  )
}

const meta: Meta<typeof RealtimeCallComposer> = {
  title: 'Chat/Realtime Call Composer',
  component: RealtimeCallComposer,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof RealtimeCallComposer>

/** Negotiation retains the same bar, with cancellation available. */
export const Connecting: Story = { render: () => <Preview state="starting" /> }
export const Listening: Story = { render: () => <Preview state="active" /> }
function AudioToSilencePreview() {
  const [silent, setSilent] = useState(false)
  return <div className="space-y-3">
    <button className="text-sm text-foreground" onClick={() => setSilent(value => !value)}>
      {silent ? 'Play audio' : 'Stop audio'}
    </button>
    <Preview state="active" activity={silent ? 'listening' : 'assistant-speaking'} />
  </div>
}
export const AudioToSilence: Story = { render: () => <AudioToSilencePreview /> }
export const Paused: Story = { render: () => <Preview state="active" paused /> }
export const AudioInterrupted: Story = { globals: { theme: 'dark', locale: 'zh' }, render: () => <Preview state="active" paused interrupted width={320} /> }
export const TaskRunning: Story = { render: () => <ComposerVoiceEntry harness="codex" projectPath={projectPath} sessionId={sessionId} disabled /> }
/** Muted channels turn their icon red so the state is visible at a glance. */
export const Muted: Story = { render: () => <Preview state="active" muted /> }
export const SpeakingWithCaptions: Story = { render: () => <Preview state="active" activity="user-speaking" captions /> }
export const HangingUp: Story = { render: () => <Preview state="stopping" /> }
export const NarrowDarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  render: () => <Preview state="active" activity="assistant-speaking" captions width={320} />,
}

/** Press M to toggle the microphone; another conversation has no start-call entry. */
export const MicrophoneShortcutAndOtherSession: Story = { render: () => <Preview state="active" otherSession /> }

/** The call bar stays bounded instead of stretching across a wide chat pane. */
export const WideDesktop: Story = { render: () => <Preview state="active" activity="assistant-speaking" captions width={1120} /> }
export const NarrowLightChinese: Story = { globals: { theme: 'light', locale: 'zh' }, render: () => <Preview state="active" width={320} /> }

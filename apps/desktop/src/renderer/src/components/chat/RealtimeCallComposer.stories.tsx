import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useCodexRealtimeViewStore } from '@/stores/codex-realtime-view'
import { resetRealtimeCallForTests, useRealtimeCallStore, type RealtimeCallActivity, type RealtimeCallState } from '@/stores/realtime-call'
import { RealtimeCallComposer } from './RealtimeCallComposer'

const projectPath = '/storybook/voice-composer'
const sessionId = 'voice-composer'

const BASH_PERMISSION: PermissionRequest = {
  requestId: 'p-bash',
  toolName: 'Bash',
  toolUseId: 'tu-bash',
  input: { command: 'bun run typecheck:web' },
  allowAlwaysAllow: false,
  riskLevel: 'medium',
  message: 'Run shell command',
}

interface PreviewProps {
  state: RealtimeCallState
  activity?: RealtimeCallActivity
  captions?: boolean
  permission?: boolean
  muted?: boolean
  width?: number
}

function Preview({ state, activity = 'listening', captions = false, permission = false, muted = false, width = 620 }: PreviewProps) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const previous = useChatStore.getState()
    const project = createDefaultProjectState()
    const session = createDefaultPerSessionState()
    Object.assign(session, {
      sessionProvider: 'codex',
      pendingPermissions: permission ? [BASH_PERMISSION] : [],
    })
    useChatStore.setState({
      activeProject: projectPath,
      projectSessions: { ...previous.projectSessions, [projectPath]: { ...project, _activeSessionId: sessionId, _sessions: { [sessionId]: session } } },
    })
    useRealtimeCallStore.setState({
      sessionId,
      state,
      activity,
      inputLevel: activity === 'user-speaking' ? 0.6 : 0,
      microphoneMuted: muted,
      outputMuted: muted,
    })
    if (captions) {
      const store = useCodexRealtimeViewStore.getState()
      store.startTranscriptItem(sessionId, { itemId: 'a', realtimeSessionId: 'rt', role: 'assistant', text: 'Checking the composer split now. 正在检查 composer 拆分。' })
      store.startTranscriptItem(sessionId, { itemId: 'u', realtimeSessionId: 'rt', role: 'user', text: 'And keep the thread view typed. 线程视图保留打字。' })
    }
    setReady(true)
    return () => {
      resetRealtimeCallForTests()
      useCodexRealtimeViewStore.setState({ sessions: {} })
      useChatStore.setState(previous)
    }
  }, [activity, captions, muted, permission, state])
  return (
    <div className="@container flex max-w-full flex-col rounded-xl border bg-card pt-2" style={{ width }}>
      {ready && <TooltipProvider><RealtimeCallComposer /></TooltipProvider>}
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

/** Negotiating: the mark breathes in its final place with a connecting line instead of controls. */
export const Connecting: Story = { render: () => <Preview state="starting" /> }
export const Listening: Story = { render: () => <Preview state="active" /> }
/** Muted channels turn their icon red so the state is visible at a glance. */
export const Muted: Story = { render: () => <Preview state="active" muted /> }
export const SpeakingWithCaptions: Story = { render: () => <Preview state="active" activity="user-speaking" captions /> }
/** A delegated Codex turn asking for permission is answered here, above the call controls. */
export const PermissionPending: Story = { render: () => <Preview state="active" activity="thinking" permission /> }
export const HangingUp: Story = { render: () => <Preview state="stopping" /> }
export const NarrowDarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  render: () => <Preview state="active" activity="assistant-speaking" captions width={320} />,
}

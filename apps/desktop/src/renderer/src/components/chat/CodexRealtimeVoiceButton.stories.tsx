import { useLayoutEffect, useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import { ArrowUp, Square } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useRealtimeCallStore, type RealtimeCallState } from '@/stores/realtime-call'
import { CodexRealtimeVoiceButton } from './CodexRealtimeVoiceButton'

const PROJECT = '/storybook/voice-entry'
const SID = 'voice-entry'

function Preview({ disabled = false, state = 'idle', otherSession = false, width = 280 }: {
  disabled?: boolean; state?: RealtimeCallState; otherSession?: boolean; width?: number
}) {
  const [taskRunning, setTaskRunning] = useState(disabled)
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const previous = useRealtimeCallStore.getState()
    useRealtimeCallStore.setState({ sessionId: state === 'idle' ? null : otherSession ? 'other-session' : SID,
      state, microphoneMuted: false, paused: false, resuming: false })
    setReady(true)
    return () => { useRealtimeCallStore.setState(previous) }
  }, [state, otherSession])

  return <div className="space-y-3 bg-background p-3 text-foreground" style={{ width }}>
    <div className="flex items-center justify-end gap-2 rounded-lg border p-2">
      {taskRunning && <IconButton size="sm" tooltip="Stop task" aria-label="Stop task"><Square /></IconButton>}
      <IconButton size="sm" disabled={taskRunning} tooltip="Send" aria-label="Send"><ArrowUp /></IconButton>
      {/* Keep this preview offline: toolbar availability is interactive, media is not acquired. */}
      <span className="contents" data-testid="voice-entry" onClickCapture={(event) => event.stopPropagation()}>
        {ready && <CodexRealtimeVoiceButton projectPath={PROJECT} sessionId={SID} disabled={taskRunning} />}
      </span>
    </div>
    <button onClick={() => setTaskRunning((running) => !running)}>
      {taskRunning ? 'Finish task' : 'Run task'}
    </button>
  </div>
}

const meta = { title: 'Chat/Codex voice entry', component: CodexRealtimeVoiceButton,
  parameters: { layout: 'centered' }, args: { projectPath: PROJECT, sessionId: SID },
} satisfies Meta<typeof CodexRealtimeVoiceButton>
export default meta
type Story = StoryObj<typeof meta>

export const Available: Story = { render: () => <Preview /> }
export const TaskRunningHidden: Story = {
  render: () => <Preview disabled />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const entry = within(canvas.getByTestId('voice-entry'))
    await expect(entry.queryByRole('button')).not.toBeInTheDocument()
    await userEvent.click(canvas.getByRole('button', { name: 'Finish task' }))
    await expect(entry.getByRole('button')).toBeEnabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Run task' }))
    await expect(entry.queryByRole('button')).not.toBeInTheDocument()
  },
}
export const StartingHidden: Story = { render: () => <Preview state="starting" /> }
export const OtherCallHidden: Story = { render: () => <Preview state="active" otherSession /> }
export const ActiveControls: Story = { render: () => <Preview state="active" disabled /> }
export const StoppingControls: Story = { render: () => <Preview state="stopping" disabled /> }
export const NarrowDarkTaskRunning: Story = { ...TaskRunningHidden, render: () => <Preview disabled width={180} />,
  globals: { theme: 'dark', locale: 'zh' } }

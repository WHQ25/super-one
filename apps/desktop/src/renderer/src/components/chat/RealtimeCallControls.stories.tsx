import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useState } from 'react'
import { resetRealtimeCallForTests, useRealtimeCallStore } from '@/stores/realtime-call'
import { RealtimeCallControls } from './RealtimeCallControls'

function Preview({ layout = 'composer', disabled = false }: {
  layout?: 'composer' | 'toolbar'; disabled?: boolean
}) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    resetRealtimeCallForTests()
    setReady(true)
    return () => resetRealtimeCallForTests()
  }, [])
  const microphoneMuted = useRealtimeCallStore(state => state.microphoneMuted)
  const paused = useRealtimeCallStore(state => state.paused)
  return <div className="flex w-80 flex-col gap-4 bg-background p-4 text-foreground">
    <div className="flex items-center justify-center gap-3">
      {ready && <RealtimeCallControls layout={layout} disabled={disabled} onPlayback={() => useRealtimeCallStore.setState(state => ({ paused: !state.paused, pauseReason: state.paused ? null : 'manual' }))} />}
    </div>
    <span className="text-xs text-muted-foreground">Microphone: {microphoneMuted ? 'muted' : 'on'} · Voice: {paused ? 'paused' : 'playing'}</span>
  </div>
}

const meta: Meta<typeof RealtimeCallControls> = {
  title: 'Chat/Realtime Call Controls',
  component: RealtimeCallControls,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof RealtimeCallControls>

/** Offline state only: no native media or agent start/stop RPC is acquired. */
export const Composer: Story = { render: () => <Preview /> }
export const Toolbar: Story = { render: () => <Preview layout="toolbar" /> }
export const Disabled: Story = { render: () => <Preview disabled /> }
export const DarkChinese: Story = {
  globals: { theme: 'dark', locale: 'zh', harness: 'codex' },
  render: () => <Preview />,
}

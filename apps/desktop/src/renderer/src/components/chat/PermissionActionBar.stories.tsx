import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ApproveRejectBar } from './PermissionActionBar'
import { setDecisionKeyboardPolicy } from './composer-slot/decision-composer-policy'

function PlatformPreview({ platform, children }: { platform: 'win32' | 'linux'; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    const original = window.app
    window.app = new Proxy(original, {
      get: (target, key, receiver) => key === 'platform' ? platform : Reflect.get(target, key, receiver),
    })
    setReady(true)
    return () => { window.app = original }
  }, [platform])
  return ready ? children : null
}

function FeedbackStory({ initialValue = '', width = 640, highRisk = false }: { initialValue?: string; width?: number; highRisk?: boolean }) {
  const root = useRef<HTMLDivElement>(null)
  const [value, setValue] = useState(initialValue)
  const [focused, setFocused] = useState(false)
  const [result, setResult] = useState('')
  useEffect(() => {
    if (root.current) return setDecisionKeyboardPolicy(root.current, 'story:feedback', highRisk)
  }, [highRisk])
  return (
    <div ref={root} data-chat-root className="@container flex flex-col gap-3 rounded-lg border border-border bg-card p-3" style={{ width, maxWidth: '100%' }}>
      <ApproveRejectBar
        onApprove={() => setResult('Approved')}
        onReject={() => setResult(`Rejected: ${value}`)}
        requireExplicitApproval={highRisk}
        feedback={{ value, onChange: setValue, focused, onFocusChange: setFocused }}
      />
      {result && <output className="whitespace-pre-wrap text-xs text-muted-foreground">{result}</output>}
    </div>
  )
}

const meta: Meta<typeof FeedbackStory> = {
  title: 'Tool UI/General/Permission Feedback',
  component: FeedbackStory,
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const ShortFeedback: Story = { args: { initialValue: 'Please preserve existing files.' } }
export const MultilineFeedback: Story = { args: { initialValue: 'Please preserve existing files.\nOnly change the selected project.' } }
export const WindowsShortcuts: Story = { ...MultilineFeedback, decorators: [(Story) => <PlatformPreview platform="win32"><Story /></PlatformPreview>] }
export const LinuxShortcuts: Story = { ...MultilineFeedback, decorators: [(Story) => <PlatformPreview platform="linux"><Story /></PlatformPreview>] }
export const Wrapping: Story = { args: { initialValue: 'Please preserve the current files and use a command that only changes the selected project. Explain the effect before continuing.' } }
export const Narrow: Story = { ...Wrapping, args: { ...Wrapping.args, width: 300 } }
export const ScrollLimit: Story = { args: { initialValue: Array.from({ length: 8 }, (_, i) => `Please address review item ${i + 1}.`).join('\n') } }
export const HighRisk: Story = { args: { highRisk: true } }

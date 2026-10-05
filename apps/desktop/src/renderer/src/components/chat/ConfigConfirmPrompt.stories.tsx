import type { Meta, StoryObj } from '@storybook/react-vite'
import { useMemo, useState } from 'react'
import { mockIpc } from '../../../../../.storybook/mock-ipc'
import { ConfigConfirmPrompt } from './ConfigConfirmPrompt'
import type { ConfigConfirmPayload } from '@superone/shared/agent-types'

const payload: ConfigConfirmPayload = { fields: [
  { key: 'name', domain: 'credential', label: 'Name', type: 'string', currentValue: 'Team', proposedValue: 'Build service' },
  { key: 'notes', domain: 'credential', label: 'Notes', type: 'string', currentValue: '', proposedValue: 'Shared with the team' },
  { key: 'description', domain: 'custom-platform', label: 'Description', type: 'string', currentValue: '', proposedValue: 'Used for automated builds and code review.' },
] }

function Review({ longContent = false }: { longContent?: boolean }) {
  useMemo(() => mockIpc('app', 'getAppSettings', async () => ({ agentPreference: {}, terminalFontSize: 14, terminalFontFamily: null })), [])
  const [result, setResult] = useState('')
  const fields = payload.fields!.map((field) => field.key === 'notes' && longContent
    ? { ...field, proposedValue: 'Keep the team credential available for existing sessions.\nUse a separate credential for the build service.\nDocument the changes before applying them.' }
    : field)
  return (
    <div className="@container">
      <ConfigConfirmPrompt payload={{ fields }} onConfirm={(value) => setResult(JSON.stringify(value))} onReject={(value) => setResult(`Rejected: ${value}`)} />
      {result && <output className="whitespace-pre-wrap text-xs text-muted-foreground">{result}</output>}
    </div>
  )
}

const meta: Meta<typeof Review> = {
  title: 'Tool UI/General/Config Confirm Prompt',
  component: Review,
  decorators: [(Story) => <div style={{ maxWidth: 640 }}><Story /></div>],
  parameters: { layout: 'padded' },
}
export default meta
type Story = StoryObj<typeof meta>
export const Default: Story = {}
export const LongNotes: Story = { args: { longContent: true } }
export const Narrow: Story = { ...LongNotes, decorators: [(Story) => <div style={{ width: 300 }}><Story /></div>] }

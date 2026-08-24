import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState, type ReactNode } from 'react'
import { ElicitationForm } from './ElicitationForm'
import type { ElicitationFormField } from '@superone/shared/agent-types'

function StoryShell({ children, width = 480 }: { children: ReactNode; width?: number }) {
  return (
    <div className="@container rounded border border-border bg-background/40 p-3" style={{ maxWidth: width }}>
      {children}
    </div>
  )
}

function ControlledForm({
  fields,
  initialValue = {},
}: {
  fields: ElicitationFormField[]
  initialValue?: Record<string, unknown>
}) {
  const [value, setValue] = useState<Record<string, unknown>>(initialValue)
  return <ElicitationForm fields={fields} value={value} onChange={setValue} />
}

const meta: Meta<typeof ElicitationForm> = {
  title: 'Tool UI/General/Permission Prompt/Elicitation Form',
  component: ElicitationForm,
  parameters: { layout: 'padded' },
  decorators: [(Story) => <StoryShell><Story /></StoryShell>],
}

export default meta
type Story = StoryObj<typeof ElicitationForm>

export const StringField: Story = {
  render: () => (
    <ControlledForm
      fields={[
        {
          name: 'projectName',
          type: 'string',
          label: 'Project name',
          description: 'Used as the .s1app filename and manifest appId.',
          required: true,
        },
      ]}
    />
  ),
}

export const NumberField: Story = {
  render: () => (
    <ControlledForm
      fields={[
        {
          name: 'port',
          type: 'number',
          label: 'Dev server port',
          description: 'Vite will fail noisily if this port is already taken.',
          required: true,
          defaultValue: 5173,
        },
      ]}
      initialValue={{ port: 5173 }}
    />
  ),
}

export const BooleanField: Story = {
  render: () => (
    <ControlledForm
      fields={[
        {
          name: 'enableTelemetry',
          type: 'boolean',
          label: 'Send anonymous telemetry',
          description: 'Helps with crash diagnostics. No source code is ever transmitted.',
          required: false,
          defaultValue: false,
        },
      ]}
    />
  ),
}

export const EnumField: Story = {
  render: () => (
    <ControlledForm
      fields={[
        {
          name: 'channel',
          type: 'enum',
          label: 'Release channel',
          required: true,
          enumOptions: ['alpha', 'beta', 'public'],
          defaultValue: 'alpha',
        },
      ]}
      initialValue={{ channel: 'alpha' }}
    />
  ),
}

export const MixedForm: Story = {
  render: () => (
    <ControlledForm
      fields={[
        {
          name: 'appName',
          type: 'string',
          label: 'App display name',
          required: true,
        },
        {
          name: 'channel',
          type: 'enum',
          label: 'Release channel',
          required: true,
          enumOptions: ['alpha', 'beta', 'public'],
        },
        {
          name: 'maxAttempts',
          type: 'number',
          label: 'Auto-retry attempts',
          description: 'Cap retries before bubbling the error.',
          required: false,
          defaultValue: 3,
        },
        {
          name: 'failFast',
          type: 'boolean',
          label: 'Fail fast on first error',
          required: false,
        },
      ]}
      initialValue={{ maxAttempts: 3 }}
    />
  ),
}

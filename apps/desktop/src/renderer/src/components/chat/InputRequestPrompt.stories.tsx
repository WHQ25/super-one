import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'
import type { InputRequestMeta } from '@superone/shared/input-request'
import { parseSchemaForm, type SchemaFormValue } from '@superone/shared/schema-form'
import { InputRequestForm } from './InputRequestPrompt'

const META: InputRequestMeta = {
  title: 'Review the implementation',
  description: 'Add context before the next change.',
  origin: { kind: 'agent' }, output: 'caller',
}
const SCHEMA = { type: 'object', required: ['notes'], properties: {
  notes: { type: 'string', title: 'Notes' },
  priority: { type: 'string', title: 'Priority', enum: ['low', 'normal', 'high'], default: 'normal' },
} }

function StoryForm({ meta = META, schema = SCHEMA, behavior = 'success', width = 640 }: {
  meta?: InputRequestMeta; schema?: unknown; behavior?: 'success' | 'retry' | 'pending'; width?: number
}) {
  const [result, setResult] = useState<unknown>(null)
  const [attempts, setAttempts] = useState(0)
  const submit = async (values: Record<string, SchemaFormValue>) => {
    if (behavior === 'pending') return new Promise<boolean>(() => {})
    setAttempts(attempts + 1)
    if (behavior === 'retry' && attempts === 0) return false
    setResult({ status: 'submitted', values })
    return true
  }
  return (
    <div data-chat-root className="rounded-xl border border-border bg-card" style={{ width, maxWidth: '100%' }}>
      <InputRequestForm meta={meta} form={parseSchemaForm(schema)} onSubmit={submit} onCancel={async () => { setResult({ status: 'cancelled' }); return true }} />
      {result !== null && <pre data-testid="input-result" className="overflow-auto p-3 text-xs">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  )
}

const config = { title: 'Chat/InputRequestPrompt', component: StoryForm, parameters: { layout: 'padded' } } satisfies Meta<typeof StoryForm>
export default config
type Story = StoryObj<typeof config>
export const AgentForm: Story = {}
export const MiniAppForm: Story = { args: { meta: { ...META, title: 'Design preferences', submitLabel: 'Apply', origin: { kind: 'miniapp', appId: 'design', appName: 'Design' } } } }
export const WidgetForm: Story = { args: { meta: { ...META, output: 'agent', origin: { kind: 'widget', messageId: 'widget-1' }, submitLabel: 'Send' } } }
export const NarrowDarkChinese: Story = { args: { width: 300 }, globals: { theme: 'dark', locale: 'zh' } }
export const LongContent: Story = { args: { schema: { type: 'object', properties: { notes: { type: 'string', title: 'Notes', default: Array.from({ length: 12 }, (_, index) => `Line ${index + 1}: Keep the original layout and add enough detail to test wrapping in a narrow pane.`).join('\n') } } }, width: 320 } }
const ONE_FIELD = { type: 'object', required: ['notes'], properties: { notes: { type: 'string', title: 'Notes' } } }
export const SubmitRetry: Story = {
  args: { schema: ONE_FIELD, behavior: 'retry' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/Notes/), 'Preserve the draft')
    await userEvent.click(canvas.getByRole('button', { name: /^Submit/ }))
    await expect(canvas.findByRole('alert')).resolves.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: /^Submit/ }))
    await expect(canvas.findByTestId('input-result')).resolves.toHaveTextContent('Preserve the draft')
  },
}
export const Submitting: Story = {
  args: { schema: ONE_FIELD, behavior: 'pending' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.type(canvas.getByLabelText(/Notes/), 'Submitting')
    await userEvent.click(canvas.getByRole('button', { name: /^Submit/ }))
    await expect(canvas.getByRole('button', { name: /^Submit/ })).toBeDisabled()
  },
}
export const Unsupported: Story = { args: { schema: { type: 'object', properties: { notes: { type: 'object' } } } } }

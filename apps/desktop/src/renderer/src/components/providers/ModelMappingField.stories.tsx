import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import type { ProviderModelEnv } from '@superone/shared/agent-types'
import type { EndpointModel } from '@superone/shared/platform-registry'
import { ModelMappingField } from './ModelMappingField'

/** The model mapping field with its pick/manual switch; edits stay in local state. */
const MIMO: EndpointModel[] = [
  { id: 'mimo-v2.6-pro', name: 'MiMo-V2.6-Pro' },
  { id: 'mimo-v2.6-flash', name: 'MiMo-V2.6-Flash' },
  { id: 'mimo-v2.5-pro', name: 'MiMo-V2.5-Pro' },
]
const ONE_M = new Set(['mimo-v2.6-pro', 'mimo-v2.5-pro'])

const PRESET: ProviderModelEnv = {
  default: { id: 'mimo-v2.6-pro[1m]', name: 'MiMo V2.6 Pro' },
  opus: { id: 'mimo-v2.6-pro[1m]', name: 'MiMo V2.6 Pro' },
  sonnet: { id: 'mimo-v2.6-pro[1m]', name: 'MiMo V2.6 Pro' },
  haiku: { id: 'mimo-v2.6-pro', name: 'MiMo V2.6 Pro' },
}

function Field({ models, initial, width = 520 }: { models: EndpointModel[]; initial: ProviderModelEnv; width?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="rounded-lg border border-border p-4" style={{ width }}>
      <ModelMappingField label="Model Mapping" models={models} oneMillionIds={ONE_M} value={value} onChange={setValue} />
    </div>
  )
}

const meta: Meta<typeof Field> = {
  title: 'Providers/ModelMappingField',
  component: Field,
  parameters: { layout: 'centered' },
}
export default meta
type Story = StoryObj<typeof Field>

/** Every mapped id is on the list, so the field opens on Select. */
export const PickFromList: Story = { args: { models: MIMO, initial: PRESET } }

/** A mapped id the list lacks (a model models.dev has not caught up with) opens on Manual. */
export const OffListIdOpensManual: Story = {
  args: { models: MIMO, initial: { ...PRESET, opus: { id: 'mimo-v2.7-pro', name: 'MiMo V2.7 Pro' } } },
}

/** No list to pick from: manual entry only, no switch. */
export const NoListManualOnly: Story = { args: { models: [], initial: {} } }

export const EmptyMapping: Story = { args: { models: MIMO, initial: {} } }

export const LongNames: Story = {
  args: {
    models: [{ id: 'provider/very-long-model-identifier-with-a-date-suffix-20260922', name: 'A Model With A Very Long Display Name For Truncation' }],
    initial: { opus: { id: 'provider/very-long-model-identifier-with-a-date-suffix-20260922', name: 'A Model With A Very Long Display Name For Truncation' } },
  },
}

export const Narrow: Story = { args: { models: MIMO, initial: PRESET, width: 360 } }

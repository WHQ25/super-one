import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  GroupedModelEffortSelector,
  type SelectorCatalogParam,
} from './GroupedModelEffortSelector'

const WINDOWS = [
  { value: '256000', label: '256K' },
  { value: '500000', label: '500K' },
]

const EFFORTS = [
  { value: 'low', label: 'Low', description: 'Quick answers with light reasoning' },
  { value: 'medium', label: 'Medium', description: 'Balanced speed and depth' },
  { value: 'high', label: 'High', description: 'Deeper reasoning, slower responses' },
]

function ContextMenu({ selected }: { selected: string }) {
  const [value, setValue] = useState(selected)
  const [effort, setEffort] = useState('high')
  const optionParams: SelectorCatalogParam[] = [{
    id: 'context',
    label: 'Context window',
    kind: 'choice',
    values: WINDOWS,
    selected: value,
  }]
  return (
    <div className="flex min-h-96 items-end justify-center rounded-lg border bg-muted/20 p-6">
      <GroupedModelEffortSelector
        models={[{ id: 'grok-4.7', name: 'Grok 4.7', description: 'Flagship' }]}
        selectedModelId="grok-4.7"
        onSelectModel={() => undefined}
        effortOptions={EFFORTS}
        selectedEffort={effort}
        onSelectEffort={setEffort}
        optionParams={optionParams}
        onOptionParamChange={(_id, next) => setValue(next)}
      />
    </div>
  )
}

const meta = {
  title: 'Chat/ACP context window',
  component: GroupedModelEffortSelector,
} satisfies Meta<typeof GroupedModelEffortSelector>

export default meta
type Story = StoryObj<typeof meta>

export const CurrentWindow: Story = {
  render: () => <ContextMenu selected="256000" />,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector('button')?.click()
  },
}

export const Selected: Story = {
  render: () => <ContextMenu selected="256000" />,
  play: async ({ canvasElement }) => {
    canvasElement.querySelector('button')?.click()
  },
}

export const SingleWindowHidden: Story = {
  render: () => (
    <div className="flex min-h-40 items-end justify-center rounded-lg border bg-muted/20 p-6">
      <GroupedModelEffortSelector
        models={[{ id: 'grok-4', name: 'Grok 4' }]}
        selectedModelId="grok-4"
        onSelectModel={() => undefined}
        effortOptions={EFFORTS}
        selectedEffort="high"
        onSelectEffort={() => undefined}
      />
    </div>
  ),
}

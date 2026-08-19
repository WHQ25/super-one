/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Feather, Layers } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import { GroupedModelEffortSelector } from './GroupedModelEffortSelector'

const modes = [
  { id: 'standard', name: 'Standard', description: 'Full tool catalog', icon: Layers },
  { id: 'minimal', name: 'Minimal', description: 'Bash and editor only', icon: Feather },
]

function renderSelector(overrides: Partial<React.ComponentProps<typeof GroupedModelEffortSelector>> = {}) {
  const onSelectMode = vi.fn()
  render(
    <GroupedModelEffortSelector
      models={[{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro' }]}
      selectedModelId="deepseek-v4-pro"
      onSelectModel={vi.fn()}
      effortOptions={[
        { value: 'low', label: 'Low' },
        { value: 'high', label: 'High' },
      ]}
      selectedEffort="high"
      onSelectEffort={vi.fn()}
      modes={modes}
      modeLabel="Mode"
      selectedModeId="standard"
      onSelectMode={onSelectMode}
      {...overrides}
    />,
  )
  return { onSelectMode }
}

describe('GroupedModelEffortSelector mode submenu', () => {
  it('shows only the selected mode icon in the trigger and selects from a submenu', async () => {
    const user = userEvent.setup()
    const { onSelectMode } = renderSelector()

    const trigger = screen.getByRole('button', { name: /DeepSeek V4 Pro/ })
    expect(trigger).toHaveTextContent('DeepSeek V4 Pro·High')
    expect(trigger).not.toHaveTextContent('Standard')
    expect(trigger.querySelector('.lucide-layers')).not.toBeNull()

    await user.click(trigger)
    expect(screen.getByText('Mode')).toBeInTheDocument()
    await user.hover(screen.getByText('Standard'))
    const minimal = await screen.findByRole('menuitem', { name: /Minimal/ })
    minimal.focus()
    await user.keyboard('{Enter}')

    expect(onSelectMode).toHaveBeenCalledWith('minimal')
  })

  it('renders the selected mode as a fixed value when mode switching is disabled', async () => {
    const user = userEvent.setup()
    renderSelector({ modesDisabled: true, modesDisabledReason: 'Mode is fixed' })

    await user.click(screen.getByRole('button', { name: /DeepSeek V4 Pro/ }))

    const fixedMode = screen.getByText('Standard').closest('[data-slot="dropdown-menu-item"]')
    expect(fixedMode).toHaveAttribute('aria-disabled', 'true')
    expect(screen.queryByText('Minimal')).not.toBeInTheDocument()
  })
})

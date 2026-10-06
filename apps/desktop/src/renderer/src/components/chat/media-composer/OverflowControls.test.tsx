/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@superone/ui/components/ui/tooltip'
import { OverflowControls, type ToolbarControl } from './OverflowControls'

const controls: ToolbarControl[] = ['Model', 'Ratio', 'Duration'].map(label => ({
  id: label, label, control: <button type="button">{`${label} control`}</button>, panelControl: <span>{`${label} panel`}</span>,
}))
function layout(rowWidth: number) {
  // Every control and the More button measure 100px.
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(rowWidth)
}
const renderRow = (max = 3) => render(<TooltipProvider><OverflowControls controls={controls} max={max} moreLabel="More Settings" /></TooltipProvider>)
afterEach(() => vi.restoreAllMocks())

it('keeps every control on the row when they fit', () => {
  layout(304)
  renderRow()
  expect(screen.getAllByRole('button', { name: /control$/ })).toHaveLength(3)
  expect(screen.queryByRole('button', { name: 'More Settings' })).not.toBeInTheDocument()
})

it('moves the lowest-priority controls into the settings panel when space runs out', () => {
  layout(250)
  renderRow()
  expect(screen.getAllByRole('button', { name: /control$/ }).map(button => button.textContent)).toEqual(['Model control'])
  fireEvent.click(screen.getByRole('button', { name: 'More Settings' }))
  expect(screen.getByText('Ratio')).toBeInTheDocument()
  expect(screen.getByText('Duration panel')).toBeInTheDocument()
  expect(screen.queryByText('Model panel')).not.toBeInTheDocument()
})

it('shows every control before the row has been laid out', () => {
  layout(0)
  renderRow()
  expect(screen.getAllByRole('button', { name: /control$/ })).toHaveLength(3)
})

it('keeps at most `max` controls on the row even when more would fit', () => {
  layout(1000)
  renderRow(2)
  expect(screen.getAllByRole('button', { name: /control$/ }).map(button => button.textContent)).toEqual(['Model control', 'Ratio control'])
  fireEvent.click(screen.getByRole('button', { name: 'More Settings' }))
  expect(screen.getByText('Duration panel')).toBeInTheDocument()
})

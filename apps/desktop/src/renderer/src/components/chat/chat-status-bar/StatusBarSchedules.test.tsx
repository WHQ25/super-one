/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { StatusBarSchedules } from './StatusBarSchedules'

it('renders nothing without schedules', () => {
  render(<StatusBarSchedules schedules={[]} />)
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

it('lists each schedule and names the autonomous loop instead of its sentinel', async () => {
  render(<StatusBarSchedules schedules={[
    { id: 'a', schedule: '*/30 * * * *', recurring: true, prompt: 'check CI' },
    { id: 'b', schedule: '40 23 * * *', recurring: false, prompt: '<<autonomous-loop-dynamic>>' },
  ]} />)
  const trigger = screen.getByRole('button')
  expect(trigger).toHaveTextContent('2')

  fireEvent.click(trigger)
  expect(await screen.findByText('check CI')).toBeInTheDocument()
  expect(screen.getByText('*/30 * * * *')).toBeInTheDocument()
  expect(screen.getByText('Autonomous loop')).toBeInTheDocument()
  expect(screen.queryByText('<<autonomous-loop-dynamic>>')).not.toBeInTheDocument()
})

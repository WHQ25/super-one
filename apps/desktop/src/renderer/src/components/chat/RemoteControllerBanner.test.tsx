/** @vitest-environment jsdom */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { RemoteControllerBanner } from './RemoteControllerBanner'

it('names the controlling device and explains the read-only state', () => {
  render(<RemoteControllerBanner label="MacBook Air" />)
  expect(screen.getByRole('status')).toHaveTextContent('Started from MacBook Air')
  expect(screen.getByRole('status')).toHaveTextContent('Only that device can send messages')
})

it('falls back when the controller gave no name', () => {
  render(<RemoteControllerBanner label={null} />)
  expect(screen.getByRole('status')).toHaveTextContent('Started from another device')
})

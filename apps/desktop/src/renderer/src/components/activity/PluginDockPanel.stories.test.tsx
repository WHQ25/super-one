/** @vitest-environment jsdom */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { composeStories } from '@storybook/react-vite'
import * as stories from './PluginDockPanel.stories'

const { UnavailableFallback, ActivePluginPanel, ErrorBoundaryFallback } = composeStories(stories)

afterEach(() => {
  cleanup()
})

describe('PluginDockPanel stories', () => {
  it('renders UnavailableFallback story', () => {
    render(<UnavailableFallback />)
    expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
  })

  it('renders ActivePluginPanel story', () => {
    render(<ActivePluginPanel />)
    expect(screen.getByText('Sample Inspector')).toBeTruthy()
    expect(screen.getByText('Key: sample:inspector')).toBeTruthy()
  })

  it('renders ErrorBoundaryFallback story without crashing', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundaryFallback />)
    expect(screen.getByText('Plugin panel unavailable')).toBeTruthy()
    spy.mockRestore()
  })
})

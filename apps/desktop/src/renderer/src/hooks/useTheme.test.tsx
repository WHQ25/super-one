/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeMode } from '@superone/shared/agent-types'
import { useTheme } from './useTheme'

function Host() {
  const { mode, dark } = useTheme()
  return <div data-testid="theme" data-mode={mode} data-dark={dark ? 'dark' : 'light'} />
}

beforeEach(() => {
  document.documentElement.className = ''
  window.app.getTheme = vi.fn(async () => ({ mode: 'dark' as ThemeMode, dark: true }))
  window.app.onThemeChange = vi.fn(() => () => {})
  window.app.setTheme = vi.fn(async () => {})
})

afterEach(() => {
  cleanup()
  document.documentElement.className = ''
})

describe('useTheme', () => {
  it('follows the saved appearance and does not write it on mount', async () => {
    render(<Host />)
    await act(async () => { await Promise.resolve() })
    expect(document.documentElement.classList.contains('dark')).toBe(true)
    expect(screen.getByTestId('theme').dataset.mode).toBe('dark')
    expect(screen.getByTestId('theme').dataset.dark).toBe('dark')
    expect(window.app.setTheme).not.toHaveBeenCalled()
  })
})

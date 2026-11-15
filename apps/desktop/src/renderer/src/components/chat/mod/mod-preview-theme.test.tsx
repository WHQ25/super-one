/** @vitest-environment jsdom */

import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModBackdropSnapshot } from '@superone/chat-view/mod-ui'
import type { ThemeMode } from '@superone/shared/agent-types'
import { resetHarnessSchemeForTests } from './mod-harness-scheme'
import { useModPreviewTheme } from './mod-preview-theme'

function backdrop(id: string, colorScheme: 'light' | 'dark'): ModBackdropSnapshot {
  return {
    result: { tree: { type: 'engine', ref: 0 }, props: { id, colorScheme }, hooked: true },
    props: {},
  }
}

function Host({ initial }: { initial?: ModBackdropSnapshot | null }) {
  const ref = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState<ModBackdropSnapshot | null | undefined>(initial)
  useModPreviewTheme(true, live, ref)
  return (
    <div ref={ref}>
      <div data-mod-placed-id="card">
        <button type="button" data-mod-key="preview-paper" onClick={() => setLive(backdrop('paper', 'light'))}>Preview</button>
        <button type="button" data-mod-key="apply-paper" onClick={() => setLive(backdrop('paper', 'light'))}>Apply</button>
        <button type="button" data-mod-key="close" onClick={() => setLive(null)}>Close</button>
      </div>
      <button type="button" data-testid="end" onClick={() => setLive(null)}>end</button>
    </div>
  )
}

beforeEach(() => {
  document.documentElement.className = 'dark'
  window.app.getTheme = vi.fn(async () => ({ mode: 'dark' as ThemeMode, dark: true }))
  window.app.setTheme = vi.fn(async () => {})
})

afterEach(() => {
  cleanup()
  resetHarnessSchemeForTests()
  document.documentElement.className = ''
})

async function flush(): Promise<void> {
  await act(async () => { await Promise.resolve() })
}

describe('mod preview theme', () => {
  it('switches the window for a preview and restores the saved mode when the look ends', async () => {
    render(<Host />)
    await act(async () => { screen.getByRole('button', { name: 'Preview' }).click() })
    await flush()
    expect(window.app.setTheme).toHaveBeenCalledWith('light')
    await act(async () => { screen.getByTestId('end').click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 900)) })
    expect(window.app.setTheme).toHaveBeenLastCalledWith('dark')
  })

  it('sets the window light or dark mode when a theme is applied', async () => {
    render(<Host />)
    await act(async () => { screen.getByRole('button', { name: 'Apply' }).click() })
    await flush()
    expect(window.app.setTheme).toHaveBeenCalledWith('light')
  })

  it('keeps the window scheme when a second light theme is previewed', async () => {
    function Two() {
      const ref = useRef<HTMLDivElement>(null)
      const [live, setLive] = useState<ModBackdropSnapshot | null | undefined>(undefined)
      useModPreviewTheme(true, live, ref)
      return (
        <div ref={ref}>
          <div data-mod-placed-id="card">
            <button type="button" data-mod-key="preview-dunes" onClick={() => setLive(backdrop('dither-dunes', 'light'))}>Dunes</button>
            <button type="button" data-mod-key="preview-paper" onClick={() => setLive(backdrop('paper-garden', 'light'))}>Paper</button>
          </div>
        </div>
      )
    }
    render(<Two />)
    await act(async () => { screen.getByRole('button', { name: 'Dunes' }).click() })
    await flush()
    await act(async () => { screen.getByRole('button', { name: 'Paper' }).click() })
    await flush()
    expect(window.app.setTheme).toHaveBeenCalledWith('light')
    expect(window.app.setTheme).not.toHaveBeenCalledWith('dark')
  })

  it('restores the saved mode when preview is closed', async () => {
    render(<Host />)
    await act(async () => { screen.getByRole('button', { name: 'Preview' }).click() })
    await flush()
    await act(async () => { screen.getByRole('button', { name: 'Close' }).click() })
    await flush()
    expect(window.app.setTheme).toHaveBeenLastCalledWith('dark')
  })
})

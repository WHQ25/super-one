/** @vitest-environment jsdom */

import { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ThemeMode } from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/session-types'
import { HARNESS_DEFAULT_BRAND_HUE, lchToCss, resolveDarkPrimary } from '@superone/shared/harness-brand'
import { useAppStore } from '@/stores/app'
import { createDefaultPerSessionState, createDefaultProjectState, useChatStore } from '@/stores/chat'
import { useHarnessTheme, usePaneHarnessTheme } from '@/hooks/useHarnessTheme'
import { BrandColorPopover } from './BrandColorPopover'

const initial = useAppStore.getState()
let themeListeners: Set<(state: { mode: ThemeMode; dark: boolean }) => void>
let mode: ThemeMode

function Surface() {
  useHarnessTheme()
  const ref = useRef<HTMLDivElement>(null)
  usePaneHarnessTheme(ref)
  return <div ref={ref} data-testid="pane"><BrandColorPopover /></div>
}

function selectHarness(harness: HarnessId) {
  const session = createDefaultPerSessionState()
  session.preferredProvider = harness
  const project = createDefaultProjectState()
  project._activeSessionId = 'theme-test'
  project._sessions = { 'theme-test': session }
  useChatStore.setState({ activeProject: '/theme-test', projectSessions: { '/theme-test': project } })
}

beforeEach(() => {
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
  mode = 'light'
  themeListeners = new Set()
  window.app.getTheme = vi.fn(async () => ({ mode, dark: mode === 'dark' }))
  window.app.onThemeChange = vi.fn(listener => {
    themeListeners.add(listener)
    return () => { themeListeners.delete(listener) }
  })
  window.app.setTheme = vi.fn(async next => {
    mode = next
    for (const listener of themeListeners) listener({ mode, dark: mode === 'dark' })
  })
  window.app.saveAppSettings = vi.fn().mockResolvedValue({})
  Object.defineProperty(window.app, 'supportsLiquidGlass', { configurable: true, value: true })
  useAppStore.setState({
    ...initial,
    brandHues: { ...initial.brandHues, claude: 20, codex: 300 },
    darkBrandHues: { ...initial.darkBrandHues, claude: 180, codex: 260 },
    tokenOverrides: { ...initial.tokenOverrides, claude: { '--background': { l: 0.8 }, '--primary': { h: 80 } } },
  })
  selectHarness('claude')
})

afterEach(() => {
  cleanup()
  useAppStore.setState(initial)
  document.documentElement.className = ''
  document.documentElement.removeAttribute('style')
})

describe('brand palette appearance controls', () => {
  it.each(Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[])(
    'keeps the original blue and primary foreground for an uncustomized dark %s', async harness => {
      mode = 'dark'
      document.documentElement.classList.add('dark')
      useAppStore.setState({ darkBrandHues: initial.darkBrandHues })
      selectHarness(harness)
      render(<Surface />)
      fireEvent.click(screen.getByRole('button', { name: /^Customize/ }))
      await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('255'))
      for (const element of [document.documentElement, screen.getByTestId('pane')]) {
        await waitFor(() => expect(element.style.getPropertyValue('--primary')).toBe('oklch(0.55 0.17 255)'))
        expect(element.style.getPropertyValue('--primary-foreground')).toBe('')
        expect(element.style.getPropertyValue('--sidebar-primary-foreground')).toBe('')
      }
    },
  )

  it('keeps the panel open across theme changes and edits only the current appearance', async () => {
    render(<Surface />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Claude Color' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    const slider = screen.getByRole('slider')
    await waitFor(() => expect(slider).toHaveValue('180'))
    expect(screen.getByRole('button', { name: 'Advanced' })).toBeInTheDocument()
    fireEvent.change(slider, { target: { value: '130' } })
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--primary')).toBe(lchToCss(resolveDarkPrimary(130))))
    expect(useAppStore.getState().brandHues.claude).toBe(20)
    expect(useAppStore.getState().tokenOverrides.claude['--primary']).toEqual({ h: 80 })
    await waitFor(() => expect(window.app.saveAppSettings).toHaveBeenCalledWith({
      agentPreference: { claude: { brandHue: 20, darkBrandHue: 130, tokenOverrides: initialOverrides(), darkTokenOverrides: {} } },
    }))
    fireEvent.click(screen.getByRole('button', { name: 'Light' }))
    await waitFor(() => expect(slider).toHaveValue('20'))
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.getByRole('combobox')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    fireEvent.click(screen.getByRole('button', { name: 'Dark' }))
    await waitFor(() => expect(screen.queryByRole('combobox')).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(screen.getByRole('slider')).toHaveValue('255'))
    expect(useAppStore.getState().brandHues.claude).toBe(20)
    await waitFor(() => expect(window.app.saveAppSettings).toHaveBeenLastCalledWith({
      agentPreference: { claude: { brandHue: 20, darkBrandHue: null, tokenOverrides: initialOverrides(), darkTokenOverrides: {} } },
    }))
  })

  it('removes light overrides in dark mode for the root and scoped pane, then restores them', async () => {
    render(<Surface />)
    const root = document.documentElement
    const pane = screen.getByTestId('pane')
    await waitFor(() => expect(pane.style.getPropertyValue('--background-l')).toBe('0.8'))
    await act(async () => { root.classList.add('dark') })
    for (const element of [root, pane]) {
      await waitFor(() => expect(element.style.getPropertyValue('--primary')).toBe(lchToCss(resolveDarkPrimary(180))))
      expect(element.style.getPropertyValue('--background-l')).toBe('')
      expect(element.style.getPropertyValue('--primary-h')).toBe('')
      expect(element.style.getPropertyValue('--sidebar-primary')).toBe(element.style.getPropertyValue('--primary'))
    }
    act(() => { selectHarness('codex') })
    await waitFor(() => expect(pane.style.getPropertyValue('--primary')).toBe(lchToCss(resolveDarkPrimary(260))))
    await act(async () => { root.classList.remove('dark') })
    await waitFor(() => expect(pane.style.getPropertyValue('--primary-h')).toBe('300'))
    expect(pane.style.getPropertyValue('--primary')).toBe('')
    expect(root.style.getPropertyValue('--primary')).toBe('')
  })

  it('edits only the dark primary in advanced mode and restores appearance controls on return', async () => {
    mode = 'dark'
    document.documentElement.classList.add('dark')
    render(<Surface />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Claude Color' }))
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }))
    expect(screen.queryByRole('button', { name: 'Light' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Dark' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveTextContent('--primary')
    for (const [name, value] of [['L', '0.6'], ['C', '0.1'], ['H', '130'], ['A', '0.8']]) {
      fireEvent.change(screen.getByRole('spinbutton', { name }), { target: { value } })
    }
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--primary')).toBe('oklch(0.6 0.1 130 / 0.8)'))
    expect(useAppStore.getState().tokenOverrides.claude).toEqual(initialOverrides())
    await waitFor(() => expect(window.app.saveAppSettings).toHaveBeenCalledWith({ agentPreference: { claude: {
      brandHue: 20, darkBrandHue: 180, tokenOverrides: initialOverrides(),
      darkTokenOverrides: { '--primary': { l: 0.6, c: 0.1, h: 130, a: 0.8 } },
    } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--primary')).toBe(lchToCss(resolveDarkPrimary(180))))
    await waitFor(() => expect(window.app.saveAppSettings).toHaveBeenLastCalledWith({ agentPreference: { claude: {
      brandHue: 20, darkBrandHue: 180, tokenOverrides: initialOverrides(), darkTokenOverrides: {},
    } } }))
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('button', { name: 'Light' })).toBeInTheDocument()
    expect(screen.getByRole('switch')).toBeInTheDocument()
  })

  it('persists glass and supports returning to the system theme', async () => {
    render(<Surface />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Claude Color' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Glass Theme' }))
    await waitFor(() => expect(document.documentElement).toHaveClass('liquid-glass'))
    expect(window.app.saveAppSettings).toHaveBeenCalledWith({ liquidGlass: true })
    fireEvent.click(screen.getByRole('button', { name: 'System' }))
    expect(window.app.setTheme).toHaveBeenCalledWith('system')
  })

  it('hides glass controls on unsupported hosts', () => {
    Object.defineProperty(window.app, 'supportsLiquidGlass', { configurable: true, value: false })
    render(<Surface />)
    fireEvent.click(screen.getByRole('button', { name: 'Customize Claude Color' }))
    expect(screen.queryByRole('switch')).not.toBeInTheDocument()
  })
})

function initialOverrides() {
  return { '--background': { l: 0.8 }, '--primary': { h: 80 } }
}

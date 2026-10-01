/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CursorAuthSettings } from './CursorAuthSettings'

vi.mock('@/hooks/useModelCatalog', () => ({
  useModelCatalog: () => ({
    catalog: null,
    loading: false,
    refreshing: false,
    refresh: vi.fn(),
  }),
}))

const getCursorAuthStatus = vi.fn()
const getCursorBaseConfig = vi.fn()
const cursorListRepositories = vi.fn()
const getModelCatalog = vi.fn()
const updateCursorBaseConfig = vi.fn()

const cursorApp = {
  getCursorAuthStatus,
  getCursorBaseConfig,
  cursorListRepositories,
  getModelCatalog,
  updateCursorBaseConfig,
  clipboardWrite: vi.fn(),
}

Object.defineProperty(window, 'app', {
  configurable: true,
  value: new Proxy(cursorApp, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver)
      return () => Promise.resolve(undefined)
    },
  }),
})

describe('CursorAuthSettings tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCursorAuthStatus.mockResolvedValue({
      configured: false,
      apiKeyName: null,
      userEmail: null,
    })
    getCursorBaseConfig.mockResolvedValue({
      disabledModelIds: [],
      runtime: 'local',
      settingSources: ['project', 'user'],
      toolPreset: 'default',
    })
    cursorListRepositories.mockResolvedValue([])
    getModelCatalog.mockResolvedValue({ providers: [] })
    updateCursorBaseConfig.mockResolvedValue({ ok: true, config: {} })
  })

  it('shows API key controls on the account tab', () => {
    render(<CursorAuthSettings section="account" />)
    expect(screen.getByText('Cursor User API Key')).toBeInTheDocument()
    expect(screen.getByText('Log in with browser')).toBeInTheDocument()
    expect(screen.queryByText('Models')).toBeNull()
    expect(screen.queryByText('Cursor Cloud Agents')).toBeNull()
  })

  it('shows tool preset on the preferences tab', () => {
    render(<CursorAuthSettings section="preferences" />)
    expect(screen.getByText('Local tool restrictions')).toBeInTheDocument()
    expect(screen.getByText('Force recover stuck local run')).toBeInTheDocument()
    expect(screen.queryByText('Models')).toBeNull()
    expect(screen.queryByText('Cursor User API Key')).toBeNull()
    expect(screen.queryByText('Cursor Cloud Agents')).toBeNull()
  })

  it('defaults compat off, discloses the policy bypass and saves only after the user selects it', async () => {
    render(<CursorAuthSettings section="preferences" />)
    await waitFor(() => expect(getCursorBaseConfig).toHaveBeenCalled())
    const toggle = screen.getByRole('switch', { name: 'MCP Apps Compatibility' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(toggle).toHaveAccessibleDescription(expect.stringContaining("outside Cursor's team MCP allowlist, network controls, and any Cursor sandbox"))
    fireEvent.click(toggle)
    expect(updateCursorBaseConfig).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Save Cursor runtime' }))
    await waitFor(() => expect(updateCursorBaseConfig).toHaveBeenCalledWith(expect.objectContaining({ mcpAppsCompatEnabled: true })))
  })

  it('loads the user opt-in and can save it off', async () => {
    getCursorBaseConfig.mockResolvedValue({ mcpAppsCompatEnabled: true })
    render(<CursorAuthSettings section="preferences" />)
    const toggle = screen.getByRole('switch', { name: 'MCP Apps Compatibility' })
    await waitFor(() => expect(toggle).toHaveAttribute('aria-checked', 'true'))
    fireEvent.click(toggle)
    fireEvent.click(screen.getByRole('button', { name: 'Save Cursor runtime' }))
    await waitFor(() => expect(updateCursorBaseConfig).toHaveBeenCalledWith(expect.objectContaining({ mcpAppsCompatEnabled: false })))
  })

  it('shows the provider models list on the models tab', () => {
    render(<CursorAuthSettings section="models" />)
    expect(screen.getByText('Models')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Search Models…')).toBeInTheDocument()
    expect(screen.queryByText('Local tool restrictions')).toBeNull()
    expect(screen.queryByText('Cursor User API Key')).toBeNull()
    expect(screen.queryByText('Cursor Cloud Agents')).toBeNull()
  })

  it('shows cloud runtime on the cloud tab', () => {
    render(<CursorAuthSettings section="cloud" />)
    expect(screen.getByText('Cursor Cloud Agents')).toBeInTheDocument()
    expect(screen.queryByText('Cursor User API Key')).toBeNull()
    expect(screen.queryByText('Models')).toBeNull()
  })
})

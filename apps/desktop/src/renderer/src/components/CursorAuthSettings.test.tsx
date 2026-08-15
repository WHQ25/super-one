/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
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

const cursorApp = {
  getCursorAuthStatus,
  getCursorBaseConfig,
  cursorListRepositories,
  getModelCatalog,
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

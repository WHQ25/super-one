/** @vitest-environment jsdom */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { LspServerInfo } from '@superone/shared/desktop-lsp'
import { useAppStore } from '@/stores/app'
import { LanguageServerSettingsSection } from './LanguageServerSettingsSection'

const PROJECT_ROOT = '/tmp/demo-project'

function makeServer(overrides: Partial<LspServerInfo> = {}): LspServerInfo {
  return {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    serverName: 'typescript-language-server',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    installStatus: 'not_installed',
    installable: true,
    installHint: null,
    version: null,
    binaryPath: null,
    managed: false,
    installError: null,
    enabled: false,
    runningWorkspaces: [],
    ...overrides,
  }
}

describe('LanguageServerSettingsSection', () => {
  const listLspServers = vi.fn(async () => [
    makeServer(),
    makeServer({
      id: 'python',
      label: 'Python',
      serverName: 'pyright',
      languages: ['python'],
      installStatus: 'installed',
      version: '1.1.0',
      managed: true,
    }),
  ])
  const installLspServer = vi.fn(async () => makeServer({ installStatus: 'installed', version: '4.3.3', managed: true }))
  const uninstallLspServer = vi.fn(async () => makeServer({ installStatus: 'not_installed' }))
  const stopLspWorkspace = vi.fn(async () => {})
  const detectProjectLspLanguages = vi.fn(async () => ({
    languages: [
      { language: 'typescript', count: 97, ratio: 0.97 },
      { language: 'html', count: 3, ratio: 0.03 },
    ],
    preferredServers: ['typescript', 'typescript-language-server'],
  }))
  const fetchLspRegistry = vi.fn(async () => [
    makeServer({
      githubRepo: 'typescript-language-server/typescript-language-server',
      githubStars: 4800,
    }),
    makeServer({
      id: 'vtsls',
      label: 'vtsls',
      serverName: 'vtsls',
      languages: ['typescript', 'tsx'],
      installStatus: 'installed',
      enabled: false,
    }),
    makeServer({
      id: 'python',
      label: 'Python',
      serverName: 'pyright',
      languages: ['python'],
      installStatus: 'installed',
      version: '1.1.0',
      managed: true,
    }),
  ])
  const saveAppSettings = vi.fn(async () => ({}))

  beforeEach(() => {
    vi.clearAllMocks()
    Object.assign(window, {
      app: {
        ...(window.app ?? {}),
        listLspServers,
        installLspServer,
        uninstallLspServer,
        stopLspWorkspace,
        detectProjectLspLanguages,
        fetchLspRegistry,
        onLspStatusChange: () => () => {},
        saveAppSettings,
      },
    })
    useAppStore.setState({
      currentFolder: PROJECT_ROOT,
      lspEnabledProjects: [],
      lspEnabledServers: { typescript: true },
    })
  })

  it('toggles project-level LSP and installs/uninstalls a managed server', async () => {
    render(<LanguageServerSettingsSection />)

    await waitFor(() => {
      expect(screen.getByText('TypeScript / JavaScript')).toBeTruthy()
      expect(screen.getByText('97%')).toBeTruthy()
      expect(screen.queryByText('Python')).toBeNull()
    })

    const installBtn = screen.getByRole('button', { name: 'Install' })
    fireEvent.click(installBtn)

    await waitFor(() => {
      expect(installLspServer).toHaveBeenCalledWith('typescript')
      expect(screen.getByRole('button', { name: 'Uninstall' })).toBeTruthy()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }))
    await waitFor(() => {
      expect(uninstallLspServer).toHaveBeenCalledWith('typescript')
    })

    const searchInput = screen.getByPlaceholderText('Search language servers or languages…')
    fireEvent.change(searchInput, { target: { value: 'python' } })
    expect(screen.queryByText('TypeScript / JavaScript')).toBeNull()
    expect(screen.getByText('Python')).toBeTruthy()

    fireEvent.change(searchInput, { target: { value: '' } })
    await waitFor(() => {
      expect(screen.getAllByText('Recommended')).toHaveLength(1)
    })

    const tsSwitch = screen.getByRole('switch', { name: 'TypeScript / JavaScript' })
    const vtslsSwitch = screen.getByRole('switch', { name: 'vtsls' })
    fireEvent.click(tsSwitch)
    await waitFor(() => {
      expect(useAppStore.getState().lspEnabledServers.typescript).toBe(true)
    })
    fireEvent.click(vtslsSwitch)
    await waitFor(() => {
      expect(useAppStore.getState().lspEnabledServers.vtsls).toBe(true)
      expect(useAppStore.getState().lspEnabledServers.typescript).toBe(false)
    })
  })
})

/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LspServerInfo } from '@superone/shared/desktop-lsp'
import { setLspClientStatus, subscribeLspRestart } from '@/lib/lsp-status-store'
import { useAppStore } from '@/stores/app'
import { LspStatusPill } from './LspStatusPill'

function makeServer(overrides: Partial<LspServerInfo> = {}): LspServerInfo {
  return {
    id: 'typescript',
    label: 'TypeScript / JavaScript',
    serverName: 'typescript-language-server',
    languages: ['typescript', 'tsx', 'javascript', 'jsx'],
    installStatus: 'installed',
    installable: true,
    installHint: null,
    version: '4.3.3',
    binaryPath: '/usr/local/bin/typescript-language-server',
    managed: false,
    installError: null,
    enabled: true,
    runningWorkspaces: [],
    ...overrides,
  }
}

describe('LspStatusPill', () => {
  const stopLspWorkspace = vi.fn(async () => {})
  const listLspServers = vi.fn<() => Promise<LspServerInfo[]>>(async () => [])

  beforeEach(() => {
    setLspClientStatus('typescript', '/repo', null)
    listLspServers.mockResolvedValue([])
    stopLspWorkspace.mockClear()
    const w = globalThis.window as unknown as Record<string, unknown>
    w.app = {
      listLspServers,
      stopLspWorkspace,
      onLspStatusChange: () => () => {},
    }
    useAppStore.setState({
      lspEnabledServers: { typescript: true },
      customLspServers: [],
    })
  })

  afterEach(() => {
    setLspClientStatus('typescript', '/repo', null)
    vi.restoreAllMocks()
  })

  it('renders nothing for remote projects or plain text files', () => {
    const { container, rerender } = render(
      <LspStatusPill workspaceRoot="remote:node:/repo" filePath="src/app.ts" language="typescript" />,
    )
    expect(container.firstChild).toBeNull()

    rerender(<LspStatusPill workspaceRoot="/repo" filePath="notes.txt" language="text" />)
    expect(container.firstChild).toBeNull()
  })

  it('renders unconfigured state and navigates to editor settings', async () => {
    const navigateTo = vi.fn()
    const setSettingsTab = vi.fn()
    useAppStore.setState({ navigateTo, setSettingsTab })

    render(<LspStatusPill workspaceRoot="/repo" filePath="src/app.ts" language="typescript" />)

    const pill = await screen.findByTestId('lsp-status-pill')
    expect(pill).toHaveAttribute('data-lsp-phase', 'unconfigured')
    expect(pill).toHaveTextContent('LSP')

    fireEvent.click(pill)
    expect(await screen.findByText('Not Configured')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'LSP Settings' }))
    expect(setSettingsTab).toHaveBeenCalledWith('editor')
    expect(navigateTo).toHaveBeenCalledWith('settings')
  })

  it('keeps trigger compact as LSP across starting, indexing, and ready while showing details in popover', async () => {
    listLspServers.mockResolvedValue([makeServer()])
    render(<LspStatusPill workspaceRoot="/repo" filePath="src/app.ts" language="typescript" />)

    await waitFor(() => {
      const pill = screen.getByTestId('lsp-status-pill')
      expect(pill).toHaveAttribute('data-lsp-phase', 'starting')
      expect(pill).toHaveTextContent('LSP')
    })

    act(() => {
      setLspClientStatus('typescript', '/repo', { phase: 'indexing', error: null })
    })

    await waitFor(() => {
      const pill = screen.getByTestId('lsp-status-pill')
      expect(pill).toHaveAttribute('data-lsp-phase', 'indexing')
      expect(pill).toHaveTextContent('LSP')
    })

    act(() => {
      setLspClientStatus('typescript', '/repo', { phase: 'ready', error: null })
    })

    await waitFor(() => {
      const pill = screen.getByTestId('lsp-status-pill')
      expect(pill).toHaveAttribute('data-lsp-phase', 'ready')
      expect(pill).toHaveTextContent('LSP')
    })

    fireEvent.click(screen.getByTestId('lsp-status-pill'))
    expect(await screen.findByText('Ready')).toBeInTheDocument()
    expect(screen.getByText('TypeScript / JavaScript')).toBeInTheDocument()
    expect(screen.getByText('Hover docs')).toBeInTheDocument()
    expect(screen.getByText('Go to definition')).toBeInTheDocument()
    expect(screen.getByText('Autocomplete')).toBeInTheDocument()
    expect(screen.getByText('Rename symbol')).toBeInTheDocument()
    expect(screen.getByText('Format document')).toBeInTheDocument()
  })

  it('displays error details and restarts workspace LSP on click', async () => {
    listLspServers.mockResolvedValue([makeServer()])
    setLspClientStatus('typescript', '/repo', { phase: 'error', error: 'Request timed out' })

    const restartSpy = vi.fn()
    const unsub = subscribeLspRestart(restartSpy)

    render(<LspStatusPill workspaceRoot="/repo" filePath="src/app.ts" language="typescript" variant="review" />)

    await waitFor(() => {
      expect(screen.getByTestId('lsp-status-pill')).toHaveAttribute('data-lsp-phase', 'error')
    })

    fireEvent.click(screen.getByTestId('lsp-status-pill'))
    expect(await screen.findByText('Error')).toBeInTheDocument()
    expect(screen.getByText('Request timed out')).toBeInTheDocument()
    expect(screen.queryByText('Autocomplete')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Restart' }))
    await waitFor(() => {
      expect(stopLspWorkspace).toHaveBeenCalledWith('typescript', '/repo')
      expect(restartSpy).toHaveBeenCalledTimes(1)
    })

    unsub()
  })

  it('aggregates multiple servers for review filePaths with standby and ready states', async () => {
    const pyServer = makeServer({
      id: 'python',
      label: 'Python',
      serverName: 'pyright',
      languages: ['python'],
    })
    listLspServers.mockResolvedValue([makeServer(), pyServer])
    setLspClientStatus('typescript', '/repo', { phase: 'ready', error: null })
    setLspClientStatus('python', '/repo', null)
    useAppStore.setState({
      lspEnabledServers: { typescript: true, python: true },
      customLspServers: [],
    })

    render(
      <LspStatusPill
        workspaceRoot="/repo"
        filePaths={['src/app.ts', 'scripts/train.py']}
        variant="review"
      />,
    )

    await waitFor(() => {
      const pill = screen.getByTestId('lsp-status-pill')
      expect(pill).toHaveAttribute('data-lsp-phase', 'ready')
      expect(pill).toHaveTextContent('LSP')
    })

    fireEvent.click(screen.getByTestId('lsp-status-pill'))
    expect(await screen.findByText('2 language servers configured for this review.')).toBeInTheDocument()
    expect(screen.getByText('TypeScript / JavaScript')).toBeInTheDocument()
    expect(screen.getByText('Python')).toBeInTheDocument()
    expect(screen.getByText('Standby')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Restart TypeScript / JavaScript' }))
    await waitFor(() => {
      expect(stopLspWorkspace).toHaveBeenCalledWith('typescript', '/repo')
    })
  })
})

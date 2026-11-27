/** @vitest-environment jsdom */

import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ExternalCliInstallEvent } from '@superone/shared/environment/external-cli-install'
import { useAppStore } from '@/stores/app'
import { ChatComposerShell } from './ChatComposerShell'

const hoisted = vi.hoisted(() => ({
  sessionState: {
    _worktreeRemoved: false,
    sessionProvider: 'acp-antigravity' as string | null,
    preferredProvider: 'acp-antigravity' as string | null,
    acpAgentId: 'antigravity' as string | null,
    draftRemoteDeviceId: null as string | null,
    draftId: null as string | null,
  },
  activeProject: '/repo/demo' as string | null,
  setHarnessResources: vi.fn(),
  initializeHarness: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('./ChatInput', () => ({
  ChatInput: () => <div data-testid="chat-input">composer-ready</div>,
}))

vi.mock('./ChatStatusBar', () => ({
  ChatStatusBar: () => <div data-testid="chat-status-bar" />,
}))

vi.mock('./CursorApiKeyDialog', () => ({
  CursorApiKeyDialog: () => null,
}))

vi.mock('./TodoPopup', () => ({
  TodoPopup: () => null,
}))

vi.mock('@/stores/chat', () => {
  const chatState = {
    get activeProject() {
      return hoisted.activeProject
    },
    projectSessions: {},
    disconnectRemoteSession: vi.fn(),
    setHarnessResources: hoisted.setHarnessResources,
    initializeHarness: hoisted.initializeHarness,
  }
  return {
    useChatStore: Object.assign(
      (selector: (s: typeof chatState) => unknown) => selector(chatState),
      { getState: () => chatState, setState: vi.fn() },
    ),
    useActiveSession: (selector: (s: typeof hoisted.sessionState) => unknown) =>
      selector(hoisted.sessionState),
    useIsRemoteLocked: () => false,
    useRemoteControlReleased: () => false,
    useSessionControlHolder: () => null,
    useSessionRemoteController: () => null,
  }
})

vi.mock('@/stores/chat-store/session-scope', () => ({
  useSessionScope: () => null,
}))

vi.mock('@/hooks/use-environment-label', () => ({
  useEnvironmentLabel: () => 'Local',
}))

vi.mock('@/hooks/use-project-harness-catalog', () => ({
  useProjectHarnessCatalog: <T,>(catalog: T) => catalog,
}))

const originalApp = window.app

describe('ChatComposerShell external CLI upgrade composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.sessionState._worktreeRemoved = false
    hoisted.sessionState.sessionProvider = 'acp-antigravity'
    hoisted.sessionState.preferredProvider = 'acp-antigravity'
    hoisted.sessionState.acpAgentId = 'antigravity'
    hoisted.activeProject = '/repo/demo'
    useAppStore.setState({
      harnessCatalog: [
        { id: 'acp-antigravity', enabled: true, state: 'incompatible', runtimeVersion: '1.5.3' },
      ],
    })
  })

  afterEach(() => {
    Object.defineProperty(window, 'app', {
      configurable: true,
      value: originalApp,
    })
    useAppStore.setState({ harnessCatalog: null })
  })

  it('replaces composer with one-click upgrade UI, streams progress, and restores normal composer on completion', async () => {
    let listener: ((event: ExternalCliInstallEvent) => void) | null = null
    let currentState: 'incompatible' | 'ready' = 'incompatible'
    let currentVersion = '1.5.3'
    let resolveUpgrade!: (value: { ok: boolean; harnessId: 'acp-antigravity'; exitCode: number }) => void

    const listHarnesses = vi.fn().mockImplementation(async () => [
      {
        id: 'acp-antigravity',
        enabled: true,
        state: currentState,
        runtimeVersion: currentVersion,
        runtimeSource: 'external',
        requiresAuth: false,
      },
    ])
    const installHarnessCli = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveUpgrade = resolve
        }),
    )
    const listAcpAgents = vi.fn().mockResolvedValue({ agents: [] })
    const refreshAcpModels = vi.fn().mockResolvedValue({ agents: [] })

    Object.defineProperty(window, 'app', {
      configurable: true,
      value: {
        platform: 'darwin',
        listHarnesses,
        installHarnessCli,
        listAcpAgents,
        refreshAcpModels,
        onHarnessCliInstallEvent: vi.fn((cb: (event: ExternalCliInstallEvent) => void) => {
          listener = cb
          return () => {
            listener = null
          }
        }),
      },
    })

    const user = userEvent.setup()
    render(<ChatComposerShell showTodoPopup={false} />)

    expect(screen.getByTestId('harness-upgrade-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-input')).toBeNull()
    expect(screen.getByText('1.5.3')).toBeInTheDocument()
    expect(screen.getByText(/requires ≥ 1\.5\.16/i)).toBeInTheDocument()

    const upgradeButton = screen.getByRole('button', { name: /upgrade/i })
    await user.click(upgradeButton)

    expect(installHarnessCli).toHaveBeenCalledWith('acp-antigravity')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()

    act(() => {
      listener?.({ harnessId: 'acp-antigravity', phase: 'start' })
      listener?.({
        harnessId: 'acp-antigravity',
        phase: 'output',
        data: '\x1b[32mDownloading agy 1.5.18...\x1b[0m\n',
      })
    })

    expect(await screen.findByTestId('composer-cli-upgrade-progress')).toHaveTextContent(
      'Downloading agy 1.5.18...',
    )
    expect(screen.queryByTestId('composer-cli-upgrade-output')).toBeNull()

    currentState = 'ready'
    currentVersion = '1.5.18'
    await act(async () => {
      listener?.({ harnessId: 'acp-antigravity', phase: 'done', exitCode: 0 })
      resolveUpgrade({ ok: true, harnessId: 'acp-antigravity', exitCode: 0 })
    })

    await waitFor(() => {
      expect(screen.getByTestId('chat-input')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('harness-upgrade-composer')).toBeNull()
    expect(listAcpAgents).toHaveBeenCalled()
    expect(refreshAcpModels).toHaveBeenCalledWith('antigravity')
  })

  it('shows error and retry button when upgrade fails', async () => {
    let listener: ((event: ExternalCliInstallEvent) => void) | null = null
    const installHarnessCli = vi.fn().mockImplementation(async () => {
      listener?.({ harnessId: 'acp-antigravity', phase: 'start' })
      listener?.({
        harnessId: 'acp-antigravity',
        phase: 'output',
        data: 'curl: (6) Could not resolve host\n',
      })
      listener?.({ harnessId: 'acp-antigravity', phase: 'error', exitCode: 6 })
      return { ok: false, harnessId: 'acp-antigravity', exitCode: 6 }
    })

    Object.defineProperty(window, 'app', {
      configurable: true,
      value: {
        platform: 'darwin',
        listHarnesses: vi.fn().mockResolvedValue([
          {
            id: 'acp-antigravity',
            enabled: true,
            state: 'incompatible',
            runtimeVersion: '1.5.3',
          },
        ]),
        installHarnessCli,
        onHarnessCliInstallEvent: vi.fn((cb: (event: ExternalCliInstallEvent) => void) => {
          listener = cb
          return () => {
            listener = null
          }
        }),
      },
    })

    const user = userEvent.setup()
    render(<ChatComposerShell showTodoPopup={false} />)

    await user.click(screen.getByRole('button', { name: /upgrade/i }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/exit code 6/i)
    expect(alert).toHaveTextContent(/Could not resolve host/i)
    expect(screen.queryByTestId('composer-cli-upgrade-output')).toBeNull()
    expect(screen.getByRole('button', { name: /retry upgrade/i })).toBeEnabled()
    expect(screen.queryByTestId('chat-input')).toBeNull()
  })
})

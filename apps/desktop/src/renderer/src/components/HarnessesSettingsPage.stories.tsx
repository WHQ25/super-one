/**
 * Storybook: Settings → Harnesses enable / download / install UI.
 * Mocks listHarnesses + enable/disable + install progress so the flow can be
 * exercised without a real runtime download.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'
import { HarnessesSettingsPage } from './HarnessesSettingsPage'

type CatalogRow = {
  id: string
  enabled: boolean
  state: string
  runtimeSource: string
  requiresAuth: boolean
  runtimeVersion?: string
  command?: string
  diagnostic?: { code: string; message: string }
}

type ProgressEvent = {
  harnessId: string
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

type ProgressListener = (event: ProgressEvent) => void

const DEFAULT_SETTINGS = {
  experimentalAgentsEnabled: false,
  enabledExperimentalAgents: [] as string[],
  harnessOrder: [] as string[],
  agentPreference: {
    claude: {
      defaultModel: '',
      defaultEffort: '',
      defaultPermissionMode: '',
      defaultSandboxMode: '',
      brandHue: null,
      tokenOverrides: {},
      disabledSkills: [],
      askUserQuestionPreviewFormat: 'markdown' as const,
    },
    codex: {
      defaultModel: '',
      defaultReasoningEffort: '',
      defaultPermissionPreset: '',
      brandHue: null,
      tokenOverrides: {},
    },
    acp: {
      enabled: false,
      brandHue: null,
      tokenOverrides: {},
      selectedAgentId: null,
    },
  },
}

function baseCatalog(overrides: Partial<Record<string, Partial<CatalogRow>>> = {}): CatalogRow[] {
  const rows: CatalogRow[] = [
    {
      id: 'claude',
      enabled: false,
      state: 'disabled',
      runtimeSource: 'none',
      requiresAuth: true,
    },
    {
      id: 'codex',
      enabled: false,
      state: 'disabled',
      runtimeSource: 'none',
      requiresAuth: true,
    },
    {
      id: 'opencode',
      enabled: false,
      state: 'disabled',
      runtimeSource: 'none',
      requiresAuth: false,
    },
    {
      id: 'acp-grok',
      enabled: false,
      state: 'disabled',
      runtimeSource: 'none',
      requiresAuth: true,
    },
  ]
  return rows.map((row) => ({ ...row, ...overrides[row.id] }))
}

type Scenario = {
  catalog: CatalogRow[]
  /** Simulate a multi-step download when enableHarness is called. */
  simulateInstall?: boolean
  /** Fail enableHarness after progress (or immediately if simulateInstall is false). */
  failInstall?: boolean | string
  /** Progress events to emit shortly after mount (for static mid-install stories). */
  seedProgress?: ProgressEvent[]
  /** Delay between seed progress events (ms). */
  seedProgressStepMs?: number
  /**
   * Align list selection via app-store deep-link fields (claude/codex only —
   * HarnessesSettingsPage listens to settingsProvider + harnessConfigSection).
   */
  select?: 'claude' | 'codex'
}

const listeners = new Set<ProgressListener>()
let catalogState: CatalogRow[] = baseCatalog()
let appSettings = { ...DEFAULT_SETTINGS, enabledExperimentalAgents: [] as string[] }
let installTimers: ReturnType<typeof setTimeout>[] = []

function clearInstallTimers(): void {
  for (const t of installTimers) clearTimeout(t)
  installTimers = []
}

function emitProgress(event: ProgressEvent): void {
  for (const cb of listeners) cb(event)
}

function setCatalogRow(id: string, patch: Partial<CatalogRow>): void {
  catalogState = catalogState.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

function installHarnessMocks(scenario: Scenario): void {
  clearInstallTimers()
  listeners.clear()
  catalogState = scenario.catalog.map((r) => ({ ...r }))
  appSettings = {
    ...DEFAULT_SETTINGS,
    enabledExperimentalAgents: [...(DEFAULT_SETTINGS.enabledExperimentalAgents ?? [])],
  }

  mockIpc('app', 'getAppSettings', async () => ({ ...appSettings }))
  mockIpc('app', 'saveAppSettings', async (patch: unknown) => {
    appSettings = { ...appSettings, ...(patch as Partial<typeof appSettings>) }
    return { ...appSettings }
  })
  mockIpc('app', 'getProjectPreferences', async () => null)
  mockIpc('app', 'listHarnesses', async () => catalogState.map((r) => ({ ...r })))

  mockIpc('app', 'onHarnessInstallProgress', (callback: unknown) => {
    const cb = callback as ProgressListener
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  })

  mockIpc('app', 'enableHarness', async (input: unknown) => {
    const { harnessId } = input as { harnessId: string }
    setCatalogRow(harnessId, {
      enabled: true,
      state: 'installing',
      runtimeSource: 'managed',
    })

    if (!scenario.simulateInstall) {
      if (scenario.failInstall) {
        const message =
          typeof scenario.failInstall === 'string'
            ? scenario.failInstall
            : 'Failed to download harness package'
        setCatalogRow(harnessId, {
          enabled: false,
          state: 'error',
          diagnostic: { code: 'install_failed', message },
        })
        emitProgress({
          harnessId,
          received: 0,
          total: 0,
          phase: 'error',
          message,
        })
        throw new Error(message)
      }
      setCatalogRow(harnessId, {
        enabled: true,
        state: 'ready',
        runtimeSource: 'managed',
        runtimeVersion: '1.0.0-story',
        command: `/tmp/superone/harnesses/${harnessId}/bin/${harnessId}`,
      })
      emitProgress({ harnessId, received: 1, total: 1, phase: 'done' })
      return { ok: true }
    }

    const total = 12 * 1024 * 1024
    const steps = 8
    return await new Promise((resolve, reject) => {
      for (let i = 1; i <= steps; i++) {
        const t = setTimeout(() => {
          const received = Math.round((total * i) / steps)
          if (i < steps) {
            emitProgress({
              harnessId,
              received,
              total,
              phase: 'download',
            })
            return
          }
          if (scenario.failInstall) {
            const message =
              typeof scenario.failInstall === 'string'
                ? scenario.failInstall
                : 'Checksum mismatch after download'
            setCatalogRow(harnessId, {
              enabled: false,
              state: 'error',
              diagnostic: { code: 'install_failed', message },
            })
            emitProgress({
              harnessId,
              received: total,
              total,
              phase: 'error',
              message,
            })
            reject(new Error(message))
            return
          }
          setCatalogRow(harnessId, {
            enabled: true,
            state: 'ready',
            runtimeSource: 'managed',
            runtimeVersion: '2.1.4-story',
            command: `/Users/demo/.superone/harnesses/${harnessId}/2.1.4/bin/${harnessId}`,
            diagnostic: undefined,
          })
          emitProgress({
            harnessId,
            received: total,
            total,
            phase: 'done',
          })
          resolve({ ok: true })
        }, i * 280)
        installTimers.push(t)
      }
    })
  })

  mockIpc('app', 'disableHarness', async (harnessId: unknown) => {
    setCatalogRow(String(harnessId), {
      enabled: false,
      state: 'disabled',
      runtimeSource: 'none',
      runtimeVersion: undefined,
      command: undefined,
      diagnostic: undefined,
    })
    return { ok: true }
  })

  mockIpc('app', 'probeHarness', async () => ({ ok: true }))
  mockIpc('app', 'ensureHarness', async () => ({ ok: true }))
  mockIpc('app', 'startDrag', () => undefined)

  // Preferences tab → DefaultProviderRow → fetchProviderData. Unmocked IPC
  // resolves to undefined and would crash credentialsForConsumer(.filter).
  mockIpc('app', 'listPlatforms', async () => [])
  mockIpc('app', 'listCredentials', async () => [])
  mockIpc('app', 'listBindings', async () => [])
  mockIpc('app', 'listAgents', async () => [])
  mockIpc('app', 'listSkills', async () => [])
  mockIpc('app', 'listMcpConfigs', async () => [])
  mockIpc('app', 'listPlugins', async () => [])
  mockIpc('app', 'listHooks', async () => [])

  useSettingsStore.setState({
    platforms: [],
    credentials: [],
    bindings: [],
    providerScope: 'local',
  })
}

function SeedProgress({ events, stepMs = 0 }: { events: ProgressEvent[]; stepMs?: number }) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    // Wait until HarnessesSettingsPage has subscribed to onHarnessInstallProgress
    // (sibling effects may run before the page's subscription).
    const timers: ReturnType<typeof setTimeout>[] = []
    const startMs = 200
    if (stepMs <= 0) {
      timers.push(
        setTimeout(() => {
          for (const e of events) emitProgress(e)
        }, startMs),
      )
    } else {
      events.forEach((e, i) => {
        timers.push(setTimeout(() => emitProgress(e), startMs + (i + 1) * stepMs))
      })
    }
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [events, stepMs])
  return null
}

function StoryFrame({
  scenario,
  children,
}: {
  scenario: Scenario
  children: ReactNode
}) {
  // Install mocks once before paint. Do not re-run on parent re-renders —
  // scenario objects in story decorators are often inline and would reset
  // catalog mid-interaction.
  useLayoutEffect(() => {
    installHarnessMocks(scenario)
    const select = scenario.select ?? 'claude'
    useAppStore.setState({
      settingsProvider: select,
      // Non-null section triggers list selection sync for claude/codex.
      harnessConfigSection: 'preferences',
    })
    return () => {
      clearInstallTimers()
      listeners.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only mock install
  }, [])

  return (
    <div className="bg-background text-foreground h-[720px] w-full max-w-[1100px] p-4">
      {scenario.seedProgress?.length ? (
        <SeedProgress
          events={scenario.seedProgress}
          stepMs={scenario.seedProgressStepMs ?? 0}
        />
      ) : null}
      {children}
    </div>
  )
}

const interactiveScenario: Scenario = {
  catalog: baseCatalog({
    claude: {
      enabled: true,
      state: 'ready',
      runtimeSource: 'managed',
      runtimeVersion: '2.0.1',
      command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
    },
  }),
  simulateInstall: true,
}

const meta: Meta<typeof HarnessesSettingsPage> = {
  title: 'Settings/Harnesses',
  component: HarnessesSettingsPage,
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Harness enable / download / install UI. Use **InteractiveInstall** to toggle disabled harnesses and watch the progress bar; other stories pin static catalog states.',
      },
    },
  },
}

export default meta
type Story = StoryObj<typeof HarnessesSettingsPage>

export const InteractiveInstall: Story = {
  name: 'Interactive — enable & download',
  decorators: [
    (Story) => (
      <StoryFrame scenario={interactiveScenario}>
        <Story />
      </StoryFrame>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story:
          'Claude starts ready. Toggle Codex / OpenCode / Grok on to simulate a multi-step managed download (progress events), then ready state with version + command. Toggle off to disable.',
      },
    },
  },
}

export const AllDisabled: Story = {
  name: 'All disabled',
  decorators: [
    (Story) => (
      <StoryFrame
        scenario={{
          catalog: baseCatalog(),
        }}
      >
        <Story />
      </StoryFrame>
    ),
  ],
}

export const Installing: Story = {
  name: 'Installing (mid download)',
  decorators: [
    (Story) => (
      <StoryFrame
        scenario={{
          select: 'codex',
          catalog: baseCatalog({
            claude: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '2.0.1',
              command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
            },
            codex: {
              enabled: true,
              state: 'installing',
              runtimeSource: 'managed',
            },
          }),
          seedProgress: [
            {
              harnessId: 'codex',
              received: 4.2 * 1024 * 1024,
              total: 12 * 1024 * 1024,
              phase: 'download',
            },
          ],
          seedProgressStepMs: 80,
        }}
      >
        <Story />
      </StoryFrame>
    ),
  ],
}

export const InstallError: Story = {
  name: 'Install error',
  decorators: [
    (Story) => (
      <StoryFrame
        scenario={{
          select: 'codex',
          catalog: baseCatalog({
            claude: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '2.0.1',
              command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
            },
            codex: {
              enabled: false,
              state: 'error',
              runtimeSource: 'managed',
              diagnostic: {
                code: 'install_failed',
                message: 'Download failed: ECONNRESET while fetching tarball from dl.super-one.dev',
              },
            },
          }),
          seedProgress: [
            {
              harnessId: 'codex',
              received: 2 * 1024 * 1024,
              total: 8 * 1024 * 1024,
              phase: 'error',
              message: 'Download failed: ECONNRESET while fetching tarball from dl.super-one.dev',
            },
          ],
          seedProgressStepMs: 80,
        }}
      >
        <Story />
      </StoryFrame>
    ),
  ],
}

export const ReadyManaged: Story = {
  name: 'Ready (managed runtime)',
  decorators: [
    (Story) => (
      <StoryFrame
        scenario={{
          catalog: baseCatalog({
            claude: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '2.1.4',
              command: '/Users/demo/.superone/harnesses/claude/2.1.4/bin/claude',
            },
            codex: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '0.45.0',
              command: '/Users/demo/.superone/harnesses/codex/0.45.0/bin/codex',
            },
            opencode: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '1.2.0',
              command: '/Users/demo/.superone/harnesses/opencode/1.2.0/bin/opencode',
            },
            'acp-grok': {
              enabled: true,
              state: 'needs_auth',
              runtimeSource: 'system',
              requiresAuth: true,
              runtimeVersion: '0.9.0',
              command: 'grok',
            },
          }),
        }}
      >
        <Story />
      </StoryFrame>
    ),
  ],
}

export const FailOnEnable: Story = {
  name: 'Interactive — fail on enable',
  decorators: [
    (Story) => (
      <StoryFrame
        scenario={{
          catalog: baseCatalog({
            claude: {
              enabled: true,
              state: 'ready',
              runtimeSource: 'managed',
              runtimeVersion: '2.0.1',
              command: '/Users/demo/.superone/harnesses/claude/2.0.1/bin/claude',
            },
          }),
          simulateInstall: true,
          failInstall: 'R2 returned 403 for channel manifest',
        }}
      >
        <Story />
      </StoryFrame>
    ),
  ],
  parameters: {
    docs: {
      description: {
        story: 'Toggle a disabled harness on: progress runs then ends in error + toast.',
      },
    },
  },
}

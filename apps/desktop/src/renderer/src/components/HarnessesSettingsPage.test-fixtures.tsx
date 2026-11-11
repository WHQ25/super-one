import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import type {
  ExternalCliHarnessId,
  ExternalCliInstallEvent,
} from '@superone/shared/environment/external-cli-install'
import { mockIpc } from '../../../../.storybook/mock-ipc'
import { useAppStore } from '@/stores/app'
import { useSettingsStore } from '@/stores/settings'

export type CatalogRow = {
  id: string
  enabled: boolean
  state: string
  runtimeSource: string
  requiresAuth: boolean
  runtimeVersion?: string
  command?: string
  diagnostic?: { code: string; message: string }
}

export type ProgressEvent = {
  harnessId: string
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

type ProgressListener = (event: ProgressEvent) => void
type CliInstallListener = (event: ExternalCliInstallEvent) => void

const DEFAULT_SETTINGS = {
  experimentalAgentsEnabled: false,
  enabledExperimentalAgents: [] as string[],
  harnessOrder: [] as string[],
  dshSubagentModelSelection: {
    enabled: true,
    allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-v4-pro' }],
  },
  agentPreference: {
    claude: {
      defaultModel: '',
      defaultEffort: '',
      defaultPermissionMode: '',
      defaultSandboxMode: '',
      brandHue: null,
      darkBrandHue: null,
      tokenOverrides: {},
      darkTokenOverrides: {},
      disabledSkills: [],
      askUserQuestionPreviewFormat: 'markdown' as const,
    },
    codex: {
      defaultModel: '',
      defaultReasoningEffort: '',
      defaultPermissionPreset: '',
      brandHue: null,
      darkBrandHue: null,
      tokenOverrides: {},
      darkTokenOverrides: {},
    },
    'acp-grok': {
      enabled: false,
      brandHue: null,
      darkBrandHue: null,
      tokenOverrides: {},
      darkTokenOverrides: {},
      selectedAgentId: null,
    },
  },
}

export function baseCatalog(
  overrides: Partial<Record<string, Partial<CatalogRow>>> = {},
): CatalogRow[] {
  const rows: CatalogRow[] = [
    { id: 'claude', enabled: false, state: 'disabled', runtimeSource: 'none', requiresAuth: true },
    { id: 'codex', enabled: false, state: 'disabled', runtimeSource: 'none', requiresAuth: true },
    { id: 'opencode', enabled: false, state: 'disabled', runtimeSource: 'external', requiresAuth: false },
    { id: 'cursor', enabled: false, state: 'disabled', runtimeSource: 'none', requiresAuth: true },
    { id: 'acp-grok', enabled: false, state: 'disabled', runtimeSource: 'external', requiresAuth: true },
    { id: 'acp-antigravity', enabled: false, state: 'disabled', runtimeSource: 'external', requiresAuth: false },
    { id: 'dsh', enabled: false, state: 'disabled', runtimeSource: 'managed', requiresAuth: true },
  ]
  return rows.map((row) => ({ ...row, ...overrides[row.id] }))
}

export type Scenario = {
  section?: 'account' | 'preferences'
  catalog: CatalogRow[]
  simulateInstall?: boolean
  failInstall?: boolean | string
  seedProgress?: ProgressEvent[]
  seedProgressStepMs?: number
  seedCliInstallEvents?: ExternalCliInstallEvent[]
  seedCliInstallStepMs?: number
  failCliInstallCode?: number
  select?: 'claude' | 'codex' | 'cursor' | 'dsh' | 'opencode' | 'acp-grok' | 'acp-antigravity'
  focusKey?: string
  catalogPending?: boolean
  width?: number
}

const listeners = new Set<ProgressListener>()
const cliInstallListeners = new Set<CliInstallListener>()
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

function emitCliInstall(event: ExternalCliInstallEvent): void {
  for (const cb of cliInstallListeners) cb(event)
}

function setCatalogRow(id: string, patch: Partial<CatalogRow>): void {
  catalogState = catalogState.map((row) => (row.id === id ? { ...row, ...patch } : row))
}

function externalBinaryPath(harnessId: ExternalCliHarnessId): string {
  if (harnessId === 'acp-grok') return '/Users/demo/.grok/bin/grok'
  if (harnessId === 'acp-antigravity') return '/Users/demo/.local/bin/agy'
  return '/Users/demo/.opencode/bin/opencode'
}

export function installHarnessMocks(scenario: Scenario): void {
  clearInstallTimers()
  listeners.clear()
  cliInstallListeners.clear()
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
  mockIpc('app', 'listHarnesses', async () => (
    scenario.catalogPending
      ? new Promise<never>(() => {})
      : catalogState.map((r) => ({ ...r }))
  ))

  mockIpc('app', 'onHarnessInstallProgress', (callback: unknown) => {
    const cb = callback as ProgressListener
    listeners.add(cb)
    return () => {
      listeners.delete(cb)
    }
  })

  mockIpc('app', 'onHarnessCliInstallEvent', (callback: unknown) => {
    const cb = callback as CliInstallListener
    cliInstallListeners.add(cb)
    return () => {
      cliInstallListeners.delete(cb)
    }
  })

  mockIpc('app', 'installHarnessCli', async (rawId: unknown) => {
    const harnessId = rawId as ExternalCliHarnessId
    emitCliInstall({ harnessId, phase: 'start' })
    const chunks = [
      '\u001b[36m==> Downloading installer...\u001b[0m\n',
      '\u001b[32m==> Extracting binary to ~/.local/bin...\u001b[0m\n',
    ]
    return await new Promise((resolve) => {
      chunks.forEach((data, idx) => {
        installTimers.push(
          setTimeout(() => emitCliInstall({ harnessId, phase: 'output', data }), (idx + 1) * 180),
        )
      })
      installTimers.push(
        setTimeout(() => {
          if (scenario.failCliInstallCode != null) {
            emitCliInstall({
              harnessId,
              phase: 'output',
              data: '\u001b[31mcurl: (6) Could not resolve host\u001b[0m\n',
            })
            emitCliInstall({
              harnessId,
              phase: 'error',
              exitCode: scenario.failCliInstallCode,
            })
            resolve({ ok: false, harnessId, exitCode: scenario.failCliInstallCode })
            return
          }
          const command = externalBinaryPath(harnessId)
          setCatalogRow(harnessId, {
            enabled: true,
            state: 'ready',
            runtimeSource: 'external',
            command,
            diagnostic: undefined,
          })
          emitCliInstall({ harnessId, phase: 'done', exitCode: 0 })
          resolve({ ok: true, harnessId, exitCode: 0 })
        }, 550),
      )
    })
  })

  mockIpc('app', 'enableHarness', async (input: unknown) => {
    const { harnessId } = input as { harnessId: string }
    if (
      (harnessId === 'acp-grok' || harnessId === 'acp-antigravity' || harnessId === 'opencode')
      && !scenario.simulateInstall
    ) {
      setCatalogRow(harnessId, {
        enabled: true,
        state: 'missing',
        runtimeSource: 'external',
        diagnostic: { code: 'not_found', message: 'configured command path was not found' },
      })
      return { ok: true }
    }

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
            emitProgress({ harnessId, received, total, phase: 'download' })
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
            emitProgress({ harnessId, received: total, total, phase: 'error', message })
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
          emitProgress({ harnessId, received: total, total, phase: 'done' })
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
  mockIpc('app', 'listPlatforms', async () => [])
  mockIpc('app', 'listCredentials', async () => [])
  mockIpc('app', 'listBindings', async () => [])
  mockIpc('app', 'listAgents', async () => [])
  mockIpc('app', 'listSkills', async () => [])
  mockIpc('app', 'listMcpConfigs', async () => [])
  mockIpc('app', 'listPlugins', async () => [])
  mockIpc('app', 'listHooks', async () => [])

  mockIpc('app', 'connectDeepseek', async () => ({
    models: [
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', description: '', provider: 'deepseek-official' },
      { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', description: '', provider: 'deepseek-official' },
    ],
  }))

  mockIpc('app', 'grokAuth', async () => {
    const row = catalogState.find((r) => r.id === 'acp-grok')
    return { status: row?.state === 'ready' ? 'signed_out' : 'unavailable' }
  })

  mockIpc('app', 'antigravityAuth', async () => {
    const row = catalogState.find((r) => r.id === 'acp-antigravity')
    return {
      status: row?.state === 'ready' ? 'signed_out' : 'unavailable',
      method: 'oauth-personal',
      config: { authMethod: 'oauth-personal' },
    }
  })

  mockIpc('app', 'getCursorAuthStatus', async () => ({
    configured: false,
    apiKeyName: null,
    userEmail: null,
  }))
  mockIpc('app', 'getCursorBaseConfig', async () => ({
    disabledModelIds: [],
    runtime: 'local',
    settingSources: ['project', 'user'],
    toolPreset: 'default',
  }))
  mockIpc('app', 'cursorListRepositories', async () => [])

  useSettingsStore.setState({
    platforms: [],
    credentials: [],
    bindings: [],
    providerScope: 'local',
  })
}

function SeedEvents({
  progressEvents,
  progressStepMs = 0,
  cliEvents,
  cliStepMs = 0,
}: {
  progressEvents?: ProgressEvent[]
  progressStepMs?: number
  cliEvents?: ExternalCliInstallEvent[]
  cliStepMs?: number
}) {
  const fired = useRef(false)
  useEffect(() => {
    if (fired.current) return
    fired.current = true
    const timers: ReturnType<typeof setTimeout>[] = []
    const startMs = 200
    if (progressEvents?.length) {
      if (progressStepMs <= 0) {
        timers.push(setTimeout(() => progressEvents.forEach(emitProgress), startMs))
      } else {
        progressEvents.forEach((e, i) => {
          timers.push(setTimeout(() => emitProgress(e), startMs + (i + 1) * progressStepMs))
        })
      }
    }
    if (cliEvents?.length) {
      if (cliStepMs <= 0) {
        timers.push(setTimeout(() => cliEvents.forEach(emitCliInstall), startMs))
      } else {
        cliEvents.forEach((e, i) => {
          timers.push(setTimeout(() => emitCliInstall(e), startMs + (i + 1) * cliStepMs))
        })
      }
    }
    return () => {
      for (const t of timers) clearTimeout(t)
    }
  }, [cliEvents, cliStepMs, progressEvents, progressStepMs])
  return null
}

export function StoryFrame({
  scenario,
  children,
}: {
  scenario: Scenario
  children: ReactNode
}) {
  useLayoutEffect(() => {
    installHarnessMocks(scenario)
    const select = scenario.select ?? 'claude'
    useAppStore.setState({
      settingsProvider: select,
      harnessConfigSection: scenario.section ?? 'preferences',
      harnessListFocusKey: scenario.focusKey ?? null,
    })
    return () => {
      clearInstallTimers()
      listeners.clear()
      cliInstallListeners.clear()
    }
  }, [])

  return (
    <div
      className="h-[720px] w-full max-w-[1100px] border border-border bg-background text-foreground"
      style={scenario.width ? { width: scenario.width } : undefined}
    >
      {scenario.seedProgress?.length || scenario.seedCliInstallEvents?.length ? (
        <SeedEvents
          progressEvents={scenario.seedProgress}
          progressStepMs={scenario.seedProgressStepMs ?? 0}
          cliEvents={scenario.seedCliInstallEvents}
          cliStepMs={scenario.seedCliInstallStepMs ?? 0}
        />
      ) : null}
      {children}
    </div>
  )
}

export const interactiveScenario: Scenario = {
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

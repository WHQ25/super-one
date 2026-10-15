import { vi } from 'vitest'
import type { AppSettings, AppSettingsPatch } from '@superone/shared/agent-types'
import { HARNESS_LAUNCH_OPTIONS } from '@superone/shared/launch-options'

const mockedFile = vi.hoisted(() => ({ contents: '{}' }))
export const settingsFile = mockedFile
vi.mock('fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const mocked = {
    ...fs,
    readFileSync: (path: Parameters<typeof fs.readFileSync>[0], ...args: unknown[]) =>
      String(path).replaceAll('\\', '/').endsWith('/app-settings.json') ? mockedFile.contents : Reflect.apply(fs.readFileSync, fs, [path, ...args]),
    writeFileSync: (path: Parameters<typeof fs.writeFileSync>[0], contents: string) => {
      if (!String(path).replaceAll('\\', '/').endsWith('/app-settings.json')) throw new Error(`Unexpected filesystem write: ${path}`)
      mockedFile.contents = contents
    },
  }
  return { ...mocked, default: mocked }
})
vi.mock('electron', () => ({
  app: { getPath: () => '/settings-contract', getName: () => 'SuperOne', isPackaged: false },
  ipcMain: { handle: vi.fn() },
}))

export type AppSettingCase = { path: string; value: unknown; initial: unknown; patch: AppSettingsPatch }

const samples: Record<string, unknown> = {
  powerMode: 'prevent-idle-sleep', locale: 'zh', themeMode: 'dark', remoteNodeAccessPort: 7799,
  notificationsPrimedAt: 123, onboardingCompletedAt: 123,
  terminalLightPalette: 'github-light', terminalDarkPalette: 'nord',
  terminalFontFamily: 'Contract Mono', uiFontFamily: 'Contract Sans',
  mermaidLightTheme: 'forest', mermaidDarkTheme: 'dark',
  browserDownloadDir: '/tmp/downloads', computerUseDedicatedDisplayId: 'display-contract',
  customAppIconPath: '/tmp/contract-icon.png', enabledExperimentalAgents: ['contract-agent'],
  webmcpTrustedOrigins: [{ origin: 'https://contract.test', tools: { search: 'fingerprint' } }],
  computerUseAlwaysAllowApps: [{ bundleId: 'test.contract', app: 'Contract' }],
  deviceControlGrants: [{ deviceId: 'contract-device', deviceName: 'Contract Device' }],
  miniAppOrder: { contract: ['app-one'] }, defaultClonePaths: { local: '/tmp/projects' },
  browserBookmarks: [{ id: 'bookmark', title: 'Contract', url: 'https://contract.test', favicon: null, groupId: null, createdAt: 123 }],
  browserBookmarkGroups: [{ id: 'group', name: 'Contract', createdAt: 123 }],
  harnessOrder: ['claude', 'codex'], suggestionHarness: { provider: 'codex', acpAgentId: null },
  secondaryHarness: { provider: 'opencode', acpAgentId: null }, suggestionMenuHarness: { provider: 'codex', acpAgentId: null },
  dshSubagentModelSelection: { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }] },
  sessionContinuationHint: { enabled: false, minContextTokens: 500_000 },
}

export function readSetting(settings: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], settings)
}

export function settingPatch(path: string, value: unknown): AppSettingsPatch {
  return path.split('.').reduceRight<unknown>((nested, key) => ({ [key]: nested }), value) as AppSettingsPatch
}

function sample(path: string, initial: unknown): unknown {
  if (Object.hasOwn(samples, path)) return samples[path]
  if (typeof initial === 'boolean') return !initial
  if (typeof initial === 'number') return initial + 1
  if (path.startsWith('agentPreference.')) {
    const [, harness, key] = path.split('.')
    if (key === 'brandHue') return 130
    if (key === 'tokenOverrides') return { '--primary': { l: 0.55, c: 0.12, h: 130 } }
    if (key === 'defaultModel') return harness === 'claude' ? 'claude-sonnet-4-6' : 'gpt-6.1-sol'
    if (key === 'defaultEffort' || key === 'defaultReasoningEffort') return 'high'
    if (key === 'defaultPermissionPreset') return 'full-access'
    if (key === 'defaultPermissionMode') return HARNESS_LAUNCH_OPTIONS[harness as keyof typeof HARNESS_LAUNCH_OPTIONS].permissionModes.at(-1) ?? ''
    if (key === 'defaultSandboxMode') return 'off'
    if (key === 'selectedAgentId') return 'contract-agent'
    if (key === 'disabledSkills') return ['contract-skill']
    if (key === 'modDevFolders') return ['/tmp/contract-mod']
    if (key === 'askUserQuestionPreviewFormat') return 'html'
    if (key === 'realtimeVoice') return 'marin'
  }
  throw new Error(`A new global setting needs a valid contract sample: ${path}`)
}

/** Discover every root field and every preference leaf, including future additions. */
export function appSettingCases(defaults: AppSettings): AppSettingCase[] {
  const out: AppSettingCase[] = []
  const walk = (value: unknown, path: string) => {
    if (path === 'agentPreference' || /^agentPreference\.[^.]+$/.test(path)
      || path === 'notifications' || path === 'notifications.kinds') {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) walk(child, `${path}.${key}`)
      return
    }
    const next = sample(path, value)
    out.push({ path, initial: value, value: next, patch: settingPatch(path, next) })
  }
  for (const [key, value] of Object.entries(defaults)) walk(value, key)
  return out
}

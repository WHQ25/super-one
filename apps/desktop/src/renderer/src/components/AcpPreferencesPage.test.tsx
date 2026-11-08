/** @vitest-environment jsdom */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { en } from '@superone/shared/i18n/en'
import { zh } from '@superone/shared/i18n/zh'

const getAppSettings = vi.fn()
const saveAppSettings = vi.fn()
const initializeHarness = vi.fn()
const setHarnessResources = vi.fn()
const invalidateDefaultAcpPreferencesCache = vi.fn()

const mockAcpResources = {
  agents: [
    { id: 'antigravity', name: 'Antigravity', installed: true, commandPreview: 'agy acp' },
  ],
  selectedAgentId: 'antigravity',
  modelsByAgentId: {},
  configByAgentId: {
    antigravity: {
      configOptions: [],
      extraModels: [
        { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)', description: '' },
        { id: 'gemini-4-argon-medium', name: 'Gemini 4 Argon (Medium)', description: '' },
        { id: 'gemini-4-argon-high', name: 'Gemini 4 Argon (High)', description: '' },
        { id: 'claude-opus-5-5-low', name: 'Claude Opus 5.5 (Low)', description: '' },
        { id: 'claude-opus-5-5-max', name: 'Claude Opus 5.5 (Max)', description: '' },
        { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', description: '' },
      ],
      selectedModelId: 'gemini-4-argon-high',
      modelConfigId: 'model',
      updatedAt: '2026-11-08T12:00:00.000Z',
    },
  },
}

vi.mock('@/stores/chat', () => ({
  useChatStore: (selector: (s: unknown) => unknown) => selector({
    harnessResources: { acp: mockAcpResources },
    initializeHarness,
    setHarnessResources,
  }),
  invalidateDefaultAcpPreferencesCache: () => invalidateDefaultAcpPreferencesCache(),
}))

function resolveKey(dict: Record<string, unknown>, key: string): string {
  const parts = key.split('.')
  let cur: unknown = dict
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return key
    }
  }
  return typeof cur === 'string' ? cur : key
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => resolveKey(en as unknown as Record<string, unknown>, key),
  }),
}))

const { AcpDefaultModelRows } = await import('./AcpPreferencesPage')

beforeEach(() => {
  vi.clearAllMocks()
  getAppSettings.mockResolvedValue({
    agentPreference: {
      acp: {
        defaultModel: '',
        defaultEffort: '',
        defaultPermissionMode: '',
        antigravityDefaultModel: 'gemini-4-argon',
        antigravityDefaultEffort: '',
        antigravityDefaultPermissionMode: 'auto',
      },
    },
  })
  saveAppSettings.mockResolvedValue({})
  Object.defineProperty(window, 'app', {
    configurable: true,
    value: { getAppSettings, saveAppSettings },
  })
})

describe('AcpDefaultModelRows', () => {
  it('renders translated Default Model and Default Thinking Effort rows and allows selecting effort for Antigravity', async () => {
    expect(resolveKey(zh as unknown as Record<string, unknown>, 'settings.preferences.defaultModel.description')).toBe('用于未选择模型的会话。')
    expect(resolveKey(zh as unknown as Record<string, unknown>, 'settings.preferences.defaultModel.updated')).toBe('默认模型已更新')
    expect(resolveKey(zh as unknown as Record<string, unknown>, 'settings.preferences.defaultModel.systemDefault')).toBe('已改用系统默认模型')

    render(<AcpDefaultModelRows acpAgentId="antigravity" />)

    await waitFor(() => {
      expect(screen.getByText('Gemini 4 Argon')).toBeInTheDocument()
    })

    expect(screen.getByText('Default Model')).toBeInTheDocument()
    expect(screen.getByText('Applied to sessions that have not picked a model.')).toBeInTheDocument()
    expect(screen.getByText('Default Reasoning Effort')).toBeInTheDocument()
    expect(screen.getByText('Applied when the selected default model supports reasoning effort selection.')).toBeInTheDocument()
    expect(screen.queryByText(/settings\.preferences\./)).not.toBeInTheDocument()

    const effortButton = screen.getByRole('button', { name: 'Default' })
    expect(effortButton).not.toBeDisabled()
    await userEvent.click(effortButton)

    expect(await screen.findByText('Low')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()

    await userEvent.click(screen.getByText('High'))

    await waitFor(() => {
      expect(saveAppSettings).toHaveBeenCalledWith({
        agentPreference: {
          acp: { antigravityDefaultEffort: 'high' },
        },
      })
    })
  })
})

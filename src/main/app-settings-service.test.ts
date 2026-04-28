import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  readFileSync: vi.fn<(path: string, encoding: string) => string>(),
  writeFileSync: vi.fn<(path: string, content: string) => void>(),
  getPath: vi.fn<(name: string) => string>(),
}))

vi.mock('fs', () => ({
  readFileSync: mocks.readFileSync,
  writeFileSync: mocks.writeFileSync,
}))

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}))

import { readAppSettings, saveAppSettings } from './app-settings-service'

function fileNotFound() {
  const err = new Error('ENOENT') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  throw err
}

describe('app-settings-service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPath.mockReturnValue('/mock-user-data')
  })

  const defaultClaude = {
    defaultModel: '',
    defaultEffort: '',
    defaultPermissionMode: '',
    defaultSandboxMode: '',
    brandHue: null,
    tokenOverrides: {},
  }
  const defaultCodex = {
    defaultModel: '',
    defaultReasoningEffort: '',
    brandHue: null,
    tokenOverrides: {},
  }
  const defaultSettings = {
    analyticsEnabled: true,
    locale: '',
    agentPreference: {
      claude: defaultClaude,
      codex: defaultCodex,
    },
  }

  describe('readAppSettings', () => {
    it('returns defaults when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('reads saved settings for both agents', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: false,
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultEffort: 'high',
            defaultPermissionMode: 'acceptEdits',
            defaultSandboxMode: 'off',
          },
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'high',
          },
        },
      }))
      expect(readAppSettings()).toEqual({
        analyticsEnabled: false,
        locale: '',
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultEffort: 'high',
            defaultPermissionMode: 'acceptEdits',
            defaultSandboxMode: 'off',
            brandHue: null,
            tokenOverrides: {},
          },
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'high',
            brandHue: null,
            tokenOverrides: {},
          },
        },
      })
    })

    it('ignores invalid boolean values and falls back to default', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({ analyticsEnabled: 'yes' }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('ignores invalid claude preference values and falls back to defaults', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: {
            defaultModel: 123,
            defaultEffort: 'bogus',
            defaultPermissionMode: 'unknown',
            defaultSandboxMode: 'nope',
          },
        },
      }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('ignores invalid codex preference values and falls back to defaults', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          codex: {
            defaultModel: 123,
            defaultReasoningEffort: 'max',
          },
        },
      }))
      expect(readAppSettings()).toEqual(defaultSettings)
    })

    it('reads legacy flat codex preference fields for backward compatibility', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: false,
        codexDefaultModel: 'gpt-5.4',
        codexDefaultReasoningEffort: 'low',
      }))
      expect(readAppSettings()).toEqual({
        analyticsEnabled: false,
        locale: '',
        agentPreference: {
          claude: defaultClaude,
          codex: {
            defaultModel: 'gpt-5.4',
            defaultReasoningEffort: 'low',
            brandHue: null,
            tokenOverrides: {},
          },
        },
      })
    })

    it('returns defaults on corrupt JSON', () => {
      mocks.readFileSync.mockReturnValue('not-json')
      expect(readAppSettings()).toEqual(defaultSettings)
    })
  })

  describe('saveAppSettings', () => {
    it('merges claude patch with existing settings', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: defaultClaude,
          codex: defaultCodex,
        },
      }))

      const result = saveAppSettings({
        agentPreference: {
          claude: {
            defaultModel: 'claude-sonnet-4-6',
            defaultPermissionMode: 'plan',
          },
        },
      })
      expect(result.agentPreference.claude.defaultModel).toBe('claude-sonnet-4-6')
      expect(result.agentPreference.claude.defaultPermissionMode).toBe('plan')
      expect(result.agentPreference.claude.defaultEffort).toBe('')
      expect(result.agentPreference.claude.defaultSandboxMode).toBe('')
      expect(result.agentPreference.codex).toEqual(defaultCodex)
    })

    it('merges codex patch while preserving claude section', () => {
      mocks.readFileSync.mockReturnValue(JSON.stringify({
        analyticsEnabled: true,
        agentPreference: {
          claude: {
            defaultModel: 'claude-opus-4-7',
            defaultEffort: 'max',
            defaultPermissionMode: 'default',
            defaultSandboxMode: 'on',
          },
          codex: defaultCodex,
        },
      }))

      const result = saveAppSettings({
        agentPreference: {
          codex: { defaultModel: 'gpt-5.4' },
        },
      })
      expect(result.agentPreference.claude.defaultModel).toBe('claude-opus-4-7')
      expect(result.agentPreference.codex.defaultModel).toBe('gpt-5.4')
    })

    it('creates file with defaults merged when file does not exist', () => {
      mocks.readFileSync.mockImplementation(fileNotFound)

      const result = saveAppSettings({})
      expect(result).toEqual(defaultSettings)
      expect(mocks.writeFileSync).toHaveBeenCalledOnce()
    })
  })
})

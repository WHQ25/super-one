import { describe, expect, it } from 'vitest'
import type { ClaudeResources, CursorResources, DeepseekResources, ModelOption } from '@superone/shared/agent-types'
import type { ChatStore } from '../types'
import { applyDeepseekResources } from './deepseek-handler'

const models: ModelOption[] = [
  {
    id: 'deepseek-chat',
    name: 'DeepSeek Chat',
    description: '',
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
]

const existingClaude: ClaudeResources = {
  models: [{ id: 'opus-4-8', name: 'Opus', description: '' }],
  account: {} as ClaudeResources['account'],
  slashCommands: [],
  skills: [],
  commands: [],
  agents: [],
  outputStyles: [],
}

const existingCursor: CursorResources = { models: [] }

function storeWithHarnessResources(): ChatStore {
  return {
    harnessResources: {
      claude: existingClaude,
      codex: null,
      acp: null,
      opencode: null,
      cursor: existingCursor,
    },
    projectSessions: {},
  } as unknown as ChatStore
}

describe('deepseek-handler', () => {
  it('merges the bundle into harnessResources.dsh without clobbering other harness entries', () => {
    const resources: DeepseekResources = {
      models,
      permissionPresets: [{ id: 'default', name: 'Default' }],
    }
    const state = storeWithHarnessResources()
    const patch = applyDeepseekResources(state, resources)

    expect(patch.harnessResources).toEqual({
      claude: existingClaude,
      codex: null,
      acp: null,
      opencode: null,
      cursor: existingCursor,
      dsh: resources,
    })
    expect(patch.harnessResources?.claude).toBe(existingClaude)
    expect(patch.harnessResources?.cursor).toBe(existingCursor)
    expect(patch.projectSessions).toBeUndefined()
  })
})

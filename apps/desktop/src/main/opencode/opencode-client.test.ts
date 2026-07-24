import { describe, expect, it } from 'vitest'
import type { Command, McpStatus, ProviderListResponse } from '@opencode-ai/sdk/v2'
import { parseModels, parseOpenCodeCommands, parseOpenCodeMcpStatus, parseOpenCodeModelSlug } from './opencode-client'

describe('opencode-client', () => {
  it('parses model slugs at the first separator', () => {
    expect(parseOpenCodeModelSlug('openrouter/anthropic/claude-sonnet')).toEqual({
      providerID: 'openrouter',
      modelID: 'anthropic/claude-sonnet',
    })
    expect(parseOpenCodeModelSlug('missing-separator')).toBeNull()
    expect(parseOpenCodeModelSlug('/missing-provider')).toBeNull()
  })

  it('returns connected models with SDK variants and defaults', () => {
    const payload = {
      connected: ['openai'],
      default: { openai: 'gpt-5', anthropic: 'claude' },
      all: [
        {
          id: 'openai',
          name: 'OpenAI',
          models: {
            'gpt-5': {
              id: 'gpt-5',
              name: 'GPT-5',
              capabilities: { reasoning: true },
              variants: { low: {}, medium: {}, turbo: {} },
            },
          },
        },
        {
          id: 'anthropic',
          name: 'Anthropic',
          models: {
            claude: {
              id: 'claude',
              name: 'Claude',
              capabilities: { reasoning: true },
              variants: { high: {} },
            },
          },
        },
      ],
    } as unknown as ProviderListResponse

    expect(parseModels(payload)).toEqual([
      {
        id: 'openai/gpt-5',
        name: 'GPT-5',
        description: 'OpenAI reasoning model',
        isDefault: true,
        supportsEffort: true,
        supportedEffortLevels: ['low', 'medium'],
      },
    ])
  })

  it('maps SDK commands and skills into slash command resources', () => {
    const commands = [
      { name: 'review', description: 'Review changes', source: 'command', hints: ['target'], template: '' },
      { name: '/deploy', source: 'skill', hints: ['env', 'version'], template: '' },
    ] as Command[]

    expect(parseOpenCodeCommands(commands)).toEqual([
      { name: 'review', description: 'Review changes', argumentHint: 'target', isSkill: false },
      { name: 'deploy', description: '', argumentHint: 'env version', isSkill: true },
    ])
  })

  it('maps OpenCode MCP auth and connection states', () => {
    const statuses = {
      github: { status: 'connected' },
      local: { status: 'disabled' },
      broken: { status: 'failed', error: 'exited' },
      oauth: { status: 'needs_auth' },
      registration: { status: 'needs_client_registration', error: 'register first' },
    } as Record<string, McpStatus>

    expect(parseOpenCodeMcpStatus(statuses)).toEqual([
      { name: 'github', status: 'connected', scope: 'project' },
      { name: 'local', status: 'disabled', scope: 'project' },
      { name: 'broken', status: 'failed', error: 'exited', scope: 'project' },
      { name: 'oauth', status: 'needs-auth', scope: 'project' },
      { name: 'registration', status: 'needs-auth', error: 'register first', scope: 'project' },
    ])
  })
})

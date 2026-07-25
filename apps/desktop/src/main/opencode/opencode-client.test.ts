import { describe, expect, it, vi } from 'vitest'
import type { Agent, Command, McpStatus, ProviderListResponse } from '@opencode-ai/sdk/v2'

vi.mock('../logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}))

import {
  OPENCODE_SERVE_ARGS,
  parseModels,
  parseOpenCodeAgents,
  parseOpenCodeCommands,
  parseOpenCodeMcpStatus,
  parseOpenCodeModelSlug,
  reapOrphanOpenCodeServers,
  toOpenCodeMcpConfig,
  withOpenCodeLocalCommands,
} from './opencode-client'

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
              limit: { context: 400_000, output: 32_000 },
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
        contextWindow: 400_000,
      },
    ])
  })

  it('adds local SDK-backed commands without duplicating server commands', () => {
    const commands = [{ name: 'review', description: '', argumentHint: '', isSkill: false }]

    expect(withOpenCodeLocalCommands(commands).map((command) => command.name)).toEqual([
      'review', 'init', 'compact', 'share', 'unshare',
    ])
    expect(withOpenCodeLocalCommands([...commands, {
      name: 'compact', description: 'Server compact', argumentHint: '', isSkill: false,
    }]).filter((command) => command.name === 'compact')).toHaveLength(1)
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

  it('keeps only visible primary agents and prefers no client-side mode coercion', () => {
    const agents = [
      {
        name: 'build',
        mode: 'primary',
        hidden: false,
        model: { providerID: 'anthropic', modelID: 'claude-sonnet-4' },
      },
      { name: 'general', mode: 'all', hidden: false },
      { name: 'explore', mode: 'subagent', hidden: false },
      { name: 'hidden', mode: 'primary', hidden: true },
    ] as Agent[]
    expect(parseOpenCodeAgents(agents)).toEqual([
      {
        id: 'build',
        name: 'build',
        description: undefined,
        modelId: 'anthropic/claude-sonnet-4',
      },
      { id: 'general', name: 'general', description: undefined, modelId: undefined },
    ])
  })

  it('converts SuperOne stdio and remote MCP configs to OpenCode format', () => {
    expect(toOpenCodeMcpConfig({
      name: 'local', type: 'stdio', scope: 'project', command: 'node', args: ['server.js'], env: { TOKEN: 'x' }, disabled: false,
    })).toEqual({ type: 'local', command: ['node', 'server.js'], environment: { TOKEN: 'x' }, enabled: true })
    expect(toOpenCodeMcpConfig({
      name: 'remote', type: 'http', scope: 'user', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer x' }, disabled: true,
    })).toEqual({ type: 'remote', url: 'https://mcp.example.com', headers: { Authorization: 'Bearer x' }, enabled: false })
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

  it('uses a stable serve argv that the orphan reaper can match exactly', () => {
    expect(OPENCODE_SERVE_ARGS).toEqual(['serve', '--hostname=127.0.0.1', '--port=0'])
  })

  it('orphan reaper is a no-op when no matching PPID=1 serve exists', () => {
    // Should not throw; typically 0 unless a prior SuperOne leak is present.
    const killed = reapOrphanOpenCodeServers()
    expect(typeof killed).toBe('number')
    expect(killed).toBeGreaterThanOrEqual(0)
  })
})

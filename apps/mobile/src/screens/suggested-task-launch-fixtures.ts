import type { SuggestedTaskLaunchOptions } from '@superone/shared/suggested-task'

export const suggestedTaskOptions: SuggestedTaskLaunchOptions = {
  profiles: [
    {
      id: 'claude-base', name: 'Claude', harnessId: 'claude', apiProviders: [{ id: 'official', name: 'Anthropic API' }, { id: 'gateway', name: 'Compatible API', modelEnv: { opus: { id: 'gateway-opus' } } }], efforts: ['low', 'high'],
      defaultConfig: { apiProviderId: 'official', model: 'sonnet', permissionMode: 'default', sandboxMode: 'on' },
      models: [{ id: 'sonnet', name: 'Sonnet' }, { id: 'opus', name: 'Opus', supportsFastMode: true }],
    },
    {
      id: 'codex-base', name: 'Codex', harnessId: 'codex', apiProviders: [], efforts: ['low', 'high'],
      defaultConfig: { model: 'gpt-basic', permissionMode: 'default' },
      models: [{ id: 'gpt-basic', name: 'GPT Basic' }, { id: 'gpt-other', name: 'GPT Other' }],
    },
  ],
  initial: { agentId: 'claude-base', settings: { model: 'opus', effort: 'high', permissionMode: 'plan' } },
}

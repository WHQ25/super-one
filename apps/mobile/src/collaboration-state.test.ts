import { describe, expect, it } from 'vitest'
import { SESSION_AGENT_LAUNCHES_FIELD, type SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { buildCollaborationFormAnswers, collaborationLaunchLabel } from './collaboration-state'

describe('collaboration confirmation', () => {
  it('preserves handoff mode and resolves profile defaults into the response', () => {
    const payload = {
      profiles: [{
        id: 'codex-base',
        name: 'Codex',
        harnessId: 'codex',
        brandKey: 'codex',
        defaultConfig: { model: 'gpt-5', effort: 'medium', permissionMode: 'default' },
        models: [],
        efforts: [],
        apiProviders: [],
      }],
      launches: [{
        launchId: 'launch-1',
        mode: 'handoff',
        agentId: 'codex-base',
        name: 'Reviewer',
        role: 'Review',
        summary: 'Review the migration',
        task: 'Review every migration gate.',
        config: { effort: 'high' },
      }],
    } as SessionAgentRequestPayload

    const answers = buildCollaborationFormAnswers(payload)
    const launches = JSON.parse(answers[SESSION_AGENT_LAUNCHES_FIELD] as string)
    expect(launches[0]).toMatchObject({
      mode: 'handoff',
      config: { model: 'gpt-5', effort: 'high', permissionMode: 'default' },
    })
    expect(collaborationLaunchLabel(payload.launches[0]!)).toBe('Hand off to')
  })
})

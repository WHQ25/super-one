import type { AgentProfileManagementAPI, AgentProfileManagementDetail, ManagedAgentProfile } from '@superone/shared/agent-profile-management'
import { parseManagedProfileDraft } from '@superone/shared/agent-profile-management'
import { profileApprovalConfig } from '@superone/shared/agent-profile'
import { BASE_SESSION_PROVIDER_DEFINITIONS, sessionProviderDisplayName } from '@superone/shared/session-provider-definitions'

export function profileManagementFixture() {
  const details = new Map<string, AgentProfileManagementDetail>()
  for (const base of BASE_SESSION_PROVIDER_DEFINITIONS) {
    const name = sessionProviderDisplayName({ ...base, isBase: true })
    const codex = base.harnessId === 'codex'
    const model = codex ? 'gpt-6.1-sol' : 'claude-opus-4-8'
    const config = { model, effort: 'high', permissionMode: 'default' as const, sandboxMode: 'on' as const,
      ...(codex ? { codexPermissionPreset: 'read-only' as const } : {}),
    }
    details.set(base.id, {
      id: base.id, name, harnessId: base.harnessId, description: '', followsDefaults: true, available: true, approved: true,
      ...(base.harnessId === 'acp' ? { acpAgentId: 'grok-build' } : {}),
      spec: { version: 1, identity: { name, description: '' } },
      catalog: { models: [{ id: model, supportedEffortLevels: ['low', 'high'], supportedReasoningEfforts: [{ value: 'low' }, { value: 'high' }] }] },
      agent: { id: base.id, name, harnessId: base.harnessId, description: '', defaultConfig: config,
        models: [{ id: model, name: model }], efforts: ['low', 'high'], apiProviders: [],
      },
      baseConfig: config, version: `version-${base.id}`, reviewToken: `review-${base.id}`,
    })
  }
  const reviewer = structuredClone(details.get('claude-base')!)
  Object.assign(reviewer, { id: 'reviewer', name: 'Reviewer', description: 'Reviews diffs and flags correctness and security issues.', followsDefaults: false })
  reviewer.spec = { version: 1, identity: { name: reviewer.name, description: reviewer.description }, instructions: 'Review the requested changes.\nExplain concrete failure scenarios and point to the affected code.\nPreserve all existing files.' }
  reviewer.agent = { ...reviewer.agent, id: reviewer.id, name: reviewer.name }
  details.set(reviewer.id, reviewer)
  let next = 1
  const api: AgentProfileManagementAPI = {
    list: async () => [...details.values()].map(({ id, name, harnessId, description, followsDefaults, available, approved, acpAgentId }): ManagedAgentProfile => ({ id, name, harnessId, description, followsDefaults, available, approved, acpAgentId })),
    get: async (id) => {
      const detail = details.get(id)
      if (!detail) throw new Error('Profile no longer exists.')
      return structuredClone(detail)
    },
    save: async (input) => {
      const source = details.get(input.sourceId)!
      const parsed = parseManagedProfileDraft(input.draft, source.harnessId)
      if (!parsed.ok) throw new Error(parsed.error)
      const spec = parsed.value
      const id = input.id ?? `profile-${next++}`
      const config = profileApprovalConfig(source.harnessId, source.catalog, source.baseConfig, spec.runtime)
      details.set(id, { ...structuredClone(source), id, name: spec.identity.name, description: spec.identity.description, spec,
        followsDefaults: false, approved: true, agent: { ...source.agent, id, name: spec.identity.name, defaultConfig: config }, version: `version-${next++}`,
      })
      return { id }
    },
    delete: async ({ id }) => { details.delete(id) },
  }
  return { api, details }
}

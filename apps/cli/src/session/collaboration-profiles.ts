import type { SessionAgentProfile } from '@superone/shared/agent-types'
import { normalizeSessionHarnessId } from '@superone/shared/environment'
import { acpAgentDisplayName, resolveHarnessBrandKey } from '@superone/shared/acp-brand'
import type { HarnessId } from '@superone/shared/session-types'
import { listHarnessApiProviders, listHarnessModels } from '../provider/resolve-service'
import type { CollaborationDeps } from './collaboration-context'

/** Agent profiles from session_providers (+ ready-harness fallback). */
export function listCollaborationProfiles(deps: CollaborationDeps): SessionAgentProfile[] {
  const { harnesses, providers, sessions, sessionProviders } = deps
  const profiles: SessionAgentProfile[] = []
  const seen = new Set<string>()
  const providerOptions = {
    experimentalClaudeOpenAiChatEnabled:
      deps.experimentalClaudeOpenAiChatEnabled?.() ?? false,
  }

  const pushProfile = (
    profileId: string,
    harnessId: HarnessId,
    name: string,
    description: string,
    /** Optional session_providers.config — multi-profile defaults. */
    profileConfig?: unknown,
  ) => {
    if (seen.has(profileId)) return
    // Same gate as session.create: never offer an agent this node cannot
    // launch. Desktop applies the identical enabled+ready rule, so a
    // remote @codex mention means the same thing on both sides.
    if (!harnesses.isSessionHarnessRunnable(harnessId)) return
    seen.add(profileId)
    const harnessModels = listHarnessModels(providers, harnessId, null, providerOptions)
    const models = harnessModels.map((m) => ({
      id: m.id,
      name: m.name || m.id,
      ...(m.description ? { description: m.description } : {}),
      ...(m.serviceTiers?.length ? { serviceTiers: m.serviceTiers } : {}),
    }))
    const defaultModel = harnessModels.find((m) => m.isDefault) ?? harnessModels[0]
    const efforts = new Set<string>()
    for (const m of harnessModels) {
      for (const e of m.supportedEffortLevels ?? []) efforts.add(e)
    }
    const cfg =
      profileConfig && typeof profileConfig === 'object' && !Array.isArray(profileConfig)
        ? (profileConfig as Record<string, unknown>)
        : {}
    const cfgModel =
      typeof cfg.model === 'string' && cfg.model.trim() ? cfg.model.trim() : undefined
    const cfgEffort =
      typeof cfg.effort === 'string' && cfg.effort.trim()
        ? cfg.effort.trim()
        : typeof cfg.reasoningEffort === 'string' && cfg.reasoningEffort.trim()
          ? cfg.reasoningEffort.trim()
          : undefined
    // ACP is a protocol, not a brand: the row's config names the concrete
    // agent (grok-build), which is what the user sees and @-mentions.
    const acpAgentId =
      harnessId === 'acp' && typeof cfg.agentId === 'string' && cfg.agentId.trim()
        ? cfg.agentId.trim()
        : null
    const modelDefault = cfgModel ?? defaultModel?.id
    const effortDefault =
      cfgEffort ??
      (efforts.has('high')
        ? 'high'
        : efforts.has('medium')
          ? 'medium'
          : efforts.size > 0
            ? [...efforts][0]
            : undefined)
    profiles.push({
      id: profileId,
      name: harnessId === 'acp' ? acpAgentDisplayName(acpAgentId) : name,
      harnessId,
      ...(acpAgentId ? { acpAgentId } : {}),
      brandKey: resolveHarnessBrandKey(harnessId, acpAgentId),
      description,
      defaultConfig: {
        ...(modelDefault ? { model: modelDefault } : {}),
        ...(effortDefault ? { effort: effortDefault } : {}),
        ...(harnessId === 'codex'
          ? { fastMode: typeof cfg.fastMode === 'boolean' ? cfg.fastMode : false }
          : {}),
      },
      models: models.length > 0 ? models : [{ id: 'default', name: 'Default' }],
      efforts: [...efforts],
      apiProviders: listHarnessApiProviders(providers, harnessId, providerOptions),
    })
  }

  // Prefer CRUD-managed session_providers (base + custom multi-profile).
  if (sessionProviders) {
    for (const p of sessionProviders.list()) {
      pushProfile(
        p.id,
        p.harnessId,
        p.name,
        p.isBase
          ? `${p.harnessId} harness with the built-in configuration`
          : `Custom ${p.harnessId} profile`,
        p.config,
      )
    }
  }

  // Fallback for a node without the session_providers store: ready harnesses,
  // plus any harness that has actually run a session here. Previously this
  // seeded EVERY catalog harness when none were ready, which offered agents
  // the node could not launch; pushProfile's gate now rejects those anyway.
  if (profiles.length === 0) {
    const seedIds = new Set<string>(harnesses.readySessionHarnessIds())
    for (const s of sessions.list()) {
      if (s.harnessId) seedIds.add(s.harnessId)
    }
    for (const id of seedIds) {
      const harnessId = (normalizeSessionHarnessId(id) ?? id) as HarnessId
      pushProfile(harnessId, harnessId, harnessId, `${harnessId} harness`)
    }
  }

  return profiles
}

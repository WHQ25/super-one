import { useMemo, useRef, useState } from 'react'
import type {
  HarnessId,
  ModelOption,
  RemoteAgentOption,
  RemoteEffortOption,
  RemoteModeOption,
  RemoteProviderOption,
  RemoteSystemInfo,
  SandboxSupportLevel,
} from '@superone/shared/agent-types'
import { findCodexFastServiceTier, resolveCodexFastServiceTier } from '@superone/shared/codex-fast-mode'
import {
  effortOptionsForModel,
  resolveSelectedEffort,
  resolveSelectedModel,
} from '../model-selection-state'
import { optionParamsForModel } from '../model-picker-state'
import type { OpenedSessionSelection } from '../session-restore-selection'
import { useMobileTheme } from '../theme/context'
import type { DraftSessionSettings } from '@superone/shared/environment/draft-rpc'

type ClaimedSelection = {
  model: string | null
  effort: string | null
  permissionMode: string | null
  /** undefined = unclaimed (host default may fill). null = claimed Fast off. */
  serviceTier?: string | null
  apiProviderId?: string | null
  selectedModeId?: string | null
  selectedAgentId?: string | null
}

function emptyClaimed(): ClaimedSelection {
  return { model: null, effort: null, permissionMode: null }
}

function resolveClaimedServiceTier(
  model: Pick<ModelOption, 'serviceTiers'> | undefined,
  claimed: string | null | undefined,
  hostDefault: boolean,
): string | null {
  if (claimed === undefined) return resolveCodexFastServiceTier(model, hostDefault)
  if (claimed === null) return null
  if (!model || model.serviceTiers?.some((tier) => tier.id === claimed)) return claimed
  return findCodexFastServiceTier(model)?.id ?? claimed
}

export function useHarnessSelection() {
  const { setBrandHue } = useMobileTheme()
  const [selectedProvider, setSelectedProvider] = useState<HarnessId>('claude')
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedEffort, setSelectedEffortState] = useState('')
  const [selectedAcpAgentId, setSelectedAcpAgentId] = useState<string | null>(null)
  const [models, setModels] = useState<NonNullable<RemoteSystemInfo['models']>>([])
  const [efforts, setEfforts] = useState<RemoteEffortOption[]>([])
  const [systemInfo, setSystemInfo] = useState<RemoteSystemInfo>({})
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedModeId, setSelectedModeId] = useState<string | null>(null)
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  // Codex Fast and Cursor catalog params are per model, so a model switch clears them.
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [modelParams, setModelParams] = useState<Record<string, string>>({})
  const [permissionMode, setPermissionModeState] = useState('default')
  const [permissionModes, setPermissionModes] = useState<string[]>([
    'default',
    'acceptEdits',
    'plan',
    'bypassPermissions',
  ])
  const [sandboxSupport, setSandboxSupport] = useState<SandboxSupportLevel>('always')
  // `false` between a harness reset and its catalog: the ids below are unknown
  // then, not "host default", and readers keyed on them must not treat the gap
  // as a change of credential.
  const [catalogReady, setCatalogReady] = useState(false)
  const draftIdentity = useRef(false)

  /**
   * What has actually been *claimed* on this harness — by a pick the user made,
   * or by the session that was opened. A host default may only fill a slot
   * nobody claimed, and the rendered state cannot answer that question: `''` is
   * a legal effort reading and `'default'` is a legal permission mode on every
   * harness, so feeding the rendered state back in as "the current choice" made
   * the desktop's own defaults unreachable forever.
   *
   * A ref rather than state: it is a memory the *next* `applySystemInfo` reads,
   * and those arrive from async catalog fetches that must not resolve against a
   * stale render's copy.
   */
  const claimed = useRef<ClaimedSelection>(emptyClaimed())

  /**
   * `current` is the opened session's own stored settings — authoritative over
   * the host defaults, and never the hook's own rendered state. A field the
   * session never set arrives empty and must fall through to the default.
   */
  const applySystemInfo = (
    provider: HarnessId,
    info: RemoteSystemInfo,
    current?: OpenedSessionSelection,
  ) => {
    // `||` throughout, not `??`: every one of these arrives as `''` when unset.
    const claimedModel = current?.model || claimed.current.model || ''
    const claimedEffort = current?.effort || claimed.current.effort || ''
    const claimedPermissionMode = current?.permissionMode || claimed.current.permissionMode || ''
    const claimedServiceTier = current && 'serviceTier' in current
      ? current.serviceTier
      : claimed.current.serviceTier
    const claimedProviderId = current && 'apiProviderId' in current
      ? current.apiProviderId ?? null
      : claimed.current.apiProviderId
    const claimedModeId = current?.selectedModeId ?? claimed.current.selectedModeId
    const claimedAgentId = current?.selectedAgentId ?? claimed.current.selectedAgentId

    // A refreshed Codex catalog may omit a working model. It is discovery data,
    // not permission to replace the model the user or restored session selected.
    const model = (provider === 'codex' || draftIdentity.current) && claimedModel ? claimedModel : resolveSelectedModel(info, claimedModel)
    // Effort follows the credential the session runs on, not the global binding.
    const providerId = claimedProviderId !== undefined ? claimedProviderId : info.selectedProviderId ?? null
    const nextEfforts = effortOptionsForModel(provider, info, model, providerId)
    const missingCodexModel = provider === 'codex' && !info.models?.some(candidate => candidate.id === model)
    const effort = (missingCodexModel || draftIdentity.current) && claimedEffort
      ? claimedEffort
      : resolveSelectedEffort(nextEfforts, claimedEffort || info.defaults?.effort)
    const modes = info.permissionModes?.length
      ? info.permissionModes
      : info.permissionPresets ?? []
    const nextPermissionMode = claimedPermissionMode && (draftIdentity.current || modes.includes(claimedPermissionMode))
      ? claimedPermissionMode
      : info.defaults?.permissionMode && modes.includes(info.defaults.permissionMode)
        ? info.defaults.permissionMode
        : modes[0] ?? 'default'

    // The session's settings become claims of their own, so the next catalog
    // refresh keeps them instead of falling back to the host default.
    claimed.current = {
      model: claimedModel || null,
      effort: claimedEffort || null,
      permissionMode: claimedPermissionMode || null,
      ...(claimedServiceTier !== undefined ? { serviceTier: claimedServiceTier } : {}),
      ...(claimedProviderId !== undefined ? { apiProviderId: claimedProviderId } : {}),
      ...(claimedModeId !== undefined ? { selectedModeId: claimedModeId } : {}),
      ...(claimedAgentId !== undefined ? { selectedAgentId: claimedAgentId } : {}),
    }

    setSystemInfo(info)
    setCatalogReady(true)
    // The catalog is the only thing that carries the host's brand hue, so this is
    // where the transcript's colour is kept honest — every path that refreshes a
    // harness goes through here.
    setBrandHue(provider, info.brandHue ?? null)
    setModels(info.models ?? [])
    if (!draftIdentity.current) {
      setSelectedAgentId(claimedAgentId !== undefined ? claimedAgentId : info.selectedAgentId ?? null)
      setSelectedModeId(claimedModeId !== undefined ? claimedModeId : info.selectedModeId ?? null)
      setSelectedProviderId(claimedProviderId !== undefined ? claimedProviderId : info.selectedProviderId ?? null)
      // Fast rides as a boolean, not a tier id: the tier belongs to the model that
      // declared it, so it is resolved here against the model actually selected.
      // A claimed value (including Fast-off `null`) outranks the host default.
      setServiceTier(provider === 'codex'
        ? resolveClaimedServiceTier(
          info.models?.find((candidate) => candidate.id === model),
          claimedServiceTier,
          info.defaults?.fastMode === true,
        )
        : null)
      setModelParams({})
    }
    setSelectedModel(model)
    setEfforts(nextEfforts)
    setSelectedEffortState(effort)
    setSandboxSupport(info.sandboxSupport ?? 'always')
    // A user-picked ACP agent outranks whatever the host happens to report:
    // the switcher chose `Grok Build`, not "whichever agent is loaded".
    setSelectedAcpAgentId((current) => provider === 'acp' ? current ?? info.acpAgentId ?? null : null)
    setPermissionModes(modes.length ? modes : ['default'])
    setPermissionModeState(nextPermissionMode)
  }

  /** `acpAgentId` names which ACP agent the switcher row stood for. */
  const resetForProvider = (provider: HarnessId, acpAgentId: string | null = null) => {
    draftIdentity.current = false
    // A pick belonged to the harness it was made on; the next one starts on its
    // own host defaults.
    claimed.current = emptyClaimed()
    setSelectedProvider(provider)
    setSystemInfo({})
    setCatalogReady(false)
    setModels([])
    setPermissionModes([])
    setPermissionModeState('default')
    setSelectedModel('')
    setSelectedEffortState('')
    setEfforts([])
    setSelectedAgentId(null)
    setSelectedModeId(null)
    setSelectedProviderId(null)
    setServiceTier(null)
    setModelParams({})
    setSelectedAcpAgentId(provider === 'acp' ? acpAgentId : null)
  }

  /** A saved draft is authoritative even when model discovery has changed. */
  const restoreDraft = (settings: DraftSessionSettings) => {
    draftIdentity.current = true
    const provider = settings.harness ?? 'claude'
    const model = (provider === 'codex' ? settings.codexModel ?? settings.model : settings.model) ?? ''
    const effort = (provider === 'codex' ? settings.codexReasoningEffort : settings.effort) ?? ''
    const permission = (provider === 'codex' ? settings.codexPermissionPreset : settings.permissionMode) ?? 'default'
    claimed.current = {
      model,
      effort,
      permissionMode: permission,
      ...(settings.codexServiceTier !== undefined ? { serviceTier: settings.codexServiceTier } : {}),
      ...(settings.apiProviderId !== undefined ? { apiProviderId: settings.apiProviderId } : {}),
      ...(settings.selectedAcpModeId !== undefined ? { selectedModeId: settings.selectedAcpModeId } : {}),
      ...(settings.openCodeAgentId !== undefined ? { selectedAgentId: settings.openCodeAgentId } : {}),
    }
    setSelectedProvider(provider)
    setSelectedModel(model)
    setSelectedEffortState(effort)
    setPermissionModeState(permission)
    setSelectedAcpAgentId(settings.acpAgentId ?? null)
    setSelectedAgentId(settings.openCodeAgentId ?? null)
    setSelectedModeId(settings.selectedAcpModeId ?? null)
    setSelectedProviderId(settings.apiProviderId ?? null)
    setServiceTier(settings.codexServiceTier ?? null)
  }

  /** Every user-facing pick is a claim: it must survive the next catalog refresh. */
  const selectModel = (model: string) => {
    const nextEfforts = effortOptionsForModel(selectedProvider, systemInfo, model, selectedProviderId)
    claimed.current.model = model
    setSelectedModel(model)
    setEfforts(nextEfforts)
    setSelectedEffortState(resolveSelectedEffort(nextEfforts, selectedEffort))
    // The option catalog belongs to the model that declared it.
    claimed.current.serviceTier = null
    setServiceTier(null)
    setModelParams({})
  }

  const setSelectedEffort = (effort: string) => {
    claimed.current.effort = effort
    setSelectedEffortState(effort)
  }

  const setPermissionMode = (mode: string) => {
    claimed.current.permissionMode = mode
    setPermissionModeState(mode)
  }

  const currentModel = models.find((model) => model.id === selectedModel)
  const optionParams = useMemo(
    () => optionParamsForModel(selectedProvider, currentModel, { serviceTier, params: modelParams }),
    [selectedProvider, currentModel, serviceTier, modelParams],
  )

  /** Codex's Fast row is a service tier; every other param is a catalog value. */
  const setOptionParam = (id: string, value: string) => {
    if (selectedProvider === 'codex' && id === 'fast') {
      const next = value === 'true' ? findCodexFastServiceTier(currentModel)?.id ?? null : null
      claimed.current.serviceTier = next
      setServiceTier(next)
      return
    }
    setModelParams((current) => ({ ...current, [id]: value }))
  }

  const selectAgent = (id: string | null) => {
    claimed.current.selectedAgentId = id
    setSelectedAgentId(id)
  }

  const selectMode = (id: string | null) => {
    claimed.current.selectedModeId = id
    setSelectedModeId(id)
  }

  const selectProvider = (id: string | null) => {
    claimed.current.apiProviderId = id
    setSelectedProviderId(id)
    // A mapped credential owns effort (desktop rule); switching back to a plain
    // one restores the slider without forgetting the level that was picked.
    const nextEfforts = effortOptionsForModel(selectedProvider, systemInfo, selectedModel, id)
    setEfforts(nextEfforts)
    if (nextEfforts.length) {
      setSelectedEffortState(resolveSelectedEffort(nextEfforts, selectedEffort || systemInfo.defaults?.effort))
    }
  }

  return {
    selectedProvider,
    setSelectedProvider,
    selectedModel,
    selectedEffort,
    setSelectedEffort,
    selectedAcpAgentId,
    activeProvider: systemInfo.activeProvider ?? null,
    activeProviderName: systemInfo.activeProvider?.name,
    models,
    efforts,
    agents: (systemInfo.agents ?? []) as RemoteAgentOption[],
    selectedAgentId,
    selectAgent,
    modes: (systemInfo.modes ?? []) as RemoteModeOption[],
    modeLabel: systemInfo.modeLabel,
    modesLocked: systemInfo.modesLocked,
    selectedModeId,
    selectMode,
    providers: (systemInfo.providers ?? []) as RemoteProviderOption[],
    selectedProviderId,
    selectProvider,
    optionParams,
    setOptionParam,
    serviceTier,
    modelParams,
    permissionMode,
    setPermissionMode,
    permissionModes,
    /**
     * Sandbox a session created now would start in. Only the host knows it, and
     * a client configuring a session that does not exist yet has nothing else to
     * read — `off` would claim the desktop runs unconfined when it does not.
     */
    defaultSandboxMode: systemInfo.defaults?.sandboxMode ?? null,
    /**
     * Whether this *host* can sandbox at all. A harness-level check answers a
     * different question, so a Windows desktop would otherwise get an
     * interactive chip whose every pick the host silently coerces back to off.
     */
    sandboxSupport,
    catalogReady,
    applySystemInfo,
    resetForProvider,
    restoreDraft,
    selectModel,
  }
}

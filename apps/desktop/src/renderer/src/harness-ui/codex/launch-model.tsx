import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap } from 'lucide-react'
import type { ModelOption } from '@superone/shared/agent-types'
import {
  codexModelSwitchSpeedPatch,
  codexSelectedServiceTier,
  codexServiceTierFromSpeedParam,
  codexSpeedOptionParam,
  codexSpeedSelectionPatch,
  findCodexFastServiceTier,
} from '@superone/shared/codex-fast-mode'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useChatStore } from '@/stores/chat'
import { formatCodexModelName, formatReasoningEffortLabel } from '@/components/chat/chat-input-utils'
import {
  GroupedModelEffortSelector,
  type SelectorEffortOption,
  type SelectorModelOption,
} from '@/components/chat/model-selector/GroupedModelEffortSelector'
import {
  effortLabel,
  liveOrProfile,
  useLaunchProviders,
  useProfileCatalog,
  type LaunchModelProps,
} from '../launch-model'
import { toSelectorModels } from '../selector-models'

const NO_MODELS: ModelOption[] = []

export function codexModelsToSelectorOptions(models: ModelOption[]): SelectorModelOption[] {
  return toSelectorModels(models, (model) => formatCodexModelName(model.name, model.id))
}

/** Keep the current effort when the model offers it, else the model's default, else its highest. */
function codexEffortFor(model: ModelOption | undefined, current: string | null | undefined): string | undefined {
  const efforts = model?.supportedReasoningEfforts?.map((effort) => effort.value) ?? []
  if (current && efforts.includes(current as typeof efforts[number])) return current
  if (model?.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)) return model.defaultReasoningEffort
  return efforts[efforts.length - 1]
}

/** Codex lists models per API key, so a local launch asks app-server for the selected key's catalog. */
function useCodexLaunchCatalog(enabled: boolean, apiProviderId: string | null) {
  const activeProject = useChatStore((s) => s.activeProject)
  const [models, setModels] = useState<ModelOption[]>(NO_MODELS)
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)

  const load = useCallback(async (force: boolean) => {
    const listModels = window.app?.codexListModels
    if (!enabled || !activeProject || typeof listModels !== 'function') {
      setModels(NO_MODELS)
      return
    }
    const id = ++requestId.current
    setLoading(true)
    try {
      const next = await listModels(activeProject, apiProviderId, force)
      if (id === requestId.current) setModels(Array.isArray(next) ? next : NO_MODELS)
    } catch {
      if (id === requestId.current) setModels(NO_MODELS)
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [enabled, activeProject, apiProviderId])

  useEffect(() => { void load(false) }, [load])
  return { models, loading, refresh: enabled ? () => { void load(true) } : undefined }
}

export function CodexLaunchModel({
  profile,
  catalog,
  apiProviderId,
  model,
  effort,
  offerFastMode,
  fastMode,
  serviceTier,
  hideApiProvider,
  optionParams,
  onOptionParamChange,
  onChange,
}: LaunchModelProps) {
  const { t } = useTranslation()
  const profileOnly = catalog === 'profile'
  const { selector } = useLaunchProviders({
    harnessId: 'codex',
    profile,
    profileOnly,
    apiProviderId,
    hideApiProvider,
    onChange,
  })
  const live = useCodexLaunchCatalog(!profileOnly, selector.selectedProviderId)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // When the catalog for the selected key arrives, keep the pick valid.
  useEffect(() => {
    if (live.models.length === 0 || (model && live.models.some((entry) => entry.id === model))) return
    const next = live.models.find((entry) => entry.isDefault) ?? live.models[0]!
    const nextEffort = codexEffortFor(next, effort)
    const currentTier = codexSelectedServiceTier(
      profile?.models.find((entry) => entry.id === model),
      { fastMode, serviceTier },
    )
    onChangeRef.current({
      model: next.id,
      ...(nextEffort ? { effort: nextEffort } : {}),
      ...(offerFastMode ? codexModelSwitchSpeedPatch(next, currentTier) : {}),
    })
  }, [live.models, model, effort, fastMode, serviceTier, offerFastMode, profile?.models])

  const profileCatalog = useProfileCatalog(profile)
  const models = useMemo(
    () => codexModelsToSelectorOptions(liveOrProfile(live.models, profileCatalog)),
    [live.models, profileCatalog],
  )
  const selected = live.models.find((entry) => entry.id === model)
  const effortOptions = useMemo<SelectorEffortOption[]>(() => {
    const efforts = selected?.supportedReasoningEfforts ?? []
    if (efforts.length > 0) {
      return efforts.map((entry) => ({
        value: entry.value,
        label: formatReasoningEffortLabel(entry.value),
        ...(entry.description ? { description: entry.description } : {}),
      }))
    }
    return (profile?.efforts ?? []).map((value) => ({ value, label: formatReasoningEffortLabel(value) }))
  }, [selected, profile?.efforts])

  // The live catalog wins over the profile's copy. Fast-only models keep the bolt;
  // a catalog with another tier (Ultrafast) chooses speed inside the model menu.
  const speedModel = (id: string | null | undefined) =>
    live.models.find((entry) => entry.id === id) ?? profileCatalog.find((entry) => entry.id === id)
  const currentTier = codexSelectedServiceTier(speedModel(model), { fastMode, serviceTier })
  const speedParam = offerFastMode && !profileOnly ? codexSpeedOptionParam(speedModel(model), currentTier) : null
  const showFast = speedParam?.kind === 'toggle'
  const optionRows = [
    ...(speedParam?.kind === 'choice' ? [speedParam] : []),
    ...(optionParams ?? []),
  ]

  return (
    <>
      {/* Fast mode rides in front of the model label as a toggleable glyph, mirroring the
          lightning bolt the chat-input model trigger shows when the Fast tier is on. */}
      {showFast && (
        <IconButton
          size="sm"
          tooltip={t('settings.preferences.fastMode.label')}
          aria-pressed={currentTier != null}
          onClick={() => onChange(codexSpeedSelectionPatch(currentTier ? null : findCodexFastServiceTier(speedModel(model))?.id ?? null))}
        >
          {/* On/off reads as filled-vs-outline in the model label's own color — the same
              contrast the chat-input trigger uses for its Fast bolt. */}
          <Zap className={cn(currentTier != null && 'fill-current')} />
        </IconButton>
      )}
      <GroupedModelEffortSelector
        models={models}
        selectedModelId={model ?? null}
        selectedModelLabel={model ? formatCodexModelName(selected?.name, model) : null}
        onSelectModel={(id) => {
          const next = speedModel(id)
          const nextEffort = codexEffortFor(live.models.find((entry) => entry.id === id), effort)
          onChange({
            model: id,
            ...(nextEffort ? { effort: nextEffort } : {}),
            ...(offerFastMode ? codexModelSwitchSpeedPatch(next, currentTier) : {}),
          })
        }}
        shouldCloseAfterModelSelect={(id) =>
          (live.models.find((entry) => entry.id === id)?.supportedReasoningEfforts?.length ?? 0) <= 1
          && codexSpeedOptionParam(speedModel(id), null)?.kind !== 'choice'}
        effortOptions={effortOptions}
        selectedEffort={effort ?? null}
        selectedEffortLabel={effortLabel(effortOptions, effort, formatReasoningEffortLabel)}
        effortLabelClassName={effort === 'ultra' ? 'codex-ultra-text' : undefined}
        onSelectEffort={(value) => onChange({ effort: value })}
        {...selector}
        optionParams={optionRows}
        onOptionParamChange={(id, value) => {
          const tier = codexServiceTierFromSpeedParam(speedModel(model), id, value)
          if (tier !== undefined) onChange(codexSpeedSelectionPatch(tier))
          else onOptionParamChange?.(id, value)
        }}
        onRefreshModels={live.refresh}
        modelsLoading={live.loading}
      />
    </>
  )
}

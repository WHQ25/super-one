import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { acpModeCatalog } from '@superone/shared/harness/acp-mode-catalog'
import { isAntigravityAcpAgent } from '@superone/shared/acp-brand'
import { formatEffortOptionLabel } from '@superone/shared/effort-labels'
import { acpAgentDefaultsFor, acpAgentPreferencePatch } from '@superone/shared/harness/session-defaults'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useHarnessCatalogRefresh } from '@/harness-ui/catalog-refresh'
import { projectAntigravityModels } from '@/harness-ui/acp/model-options'
import { getCachedAcpCatalog } from '@/stores/chat-store/harness/acp-handler'
import { invalidateDefaultAcpPreferencesCache, useChatStore } from '@/stores/chat'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'

export function AcpDefaultModelRows({ acpAgentId }: { acpAgentId?: string | null }) {
  const { t } = useTranslation()
  const acpResources = useChatStore((s) => s.harnessResources.acp)
  const catalogRefresh = useHarnessCatalogRefresh('acp', true)
  const initializeHarness = useChatStore((s) => s.initializeHarness)
  const setHarnessResources = useChatStore((s) => s.setHarnessResources)

  const [defaultModel, setDefaultModel] = useState<string>('')
  const [defaultEffort, setDefaultEffort] = useState<string>('')
  const [fallbackAgentId, setFallbackAgentId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [modelOpen, setModelOpen] = useState(false)
  const [effortOpen, setEffortOpen] = useState(false)

  const resolvedAgentId = acpAgentId ?? fallbackAgentId ?? acpResources?.selectedAgentId ?? 'grok-build'
  const isAntigravity = isAntigravityAcpAgent(resolvedAgentId)

  const localizedEffortLabels = useMemo<Record<string, string>>(() => ({
    low: t('settings.preferences.effort.levels.low'),
    medium: t('settings.preferences.effort.levels.medium'),
    high: t('settings.preferences.effort.levels.high'),
    xhigh: t('settings.preferences.effort.levels.xhigh'),
    max: t('settings.preferences.effort.levels.max'),
  }), [t])

  useEffect(() => {
    void initializeHarness('acp')
  }, [initializeHarness])

  useEffect(() => {
    let mounted = true
    setLoading(true)
    window.app.getAppSettings().then((settings) => {
      if (!mounted) return
      const targetAgentId = acpAgentId ?? settings.agentPreference.acp?.selectedAgentId ?? 'grok-build'
      setFallbackAgentId(settings.agentPreference.acp?.selectedAgentId ?? null)
      const defaults = acpAgentDefaultsFor(settings.agentPreference.acp, targetAgentId)
      setDefaultModel(defaults.defaultModel)
      setDefaultEffort(defaults.defaultEffort)
    }).finally(() => {
      if (mounted) setLoading(false)
    })
    return () => {
      mounted = false
    }
  }, [acpAgentId])

  const catalog = useMemo(
    () => getCachedAcpCatalog(acpResources, resolvedAgentId),
    [acpResources, resolvedAgentId],
  )

  useEffect(() => {
    if (catalog?.models.length || !resolvedAgentId) return
    let cancelled = false
    void window.app.refreshAcpModels?.(resolvedAgentId).then((fresh) => {
      if (!cancelled && fresh) {
        setHarnessResources('acp', fresh)
      }
    }).catch(() => {})
    return () => {
      cancelled = true
    }
  }, [catalog?.models.length, resolvedAgentId, setHarnessResources])

  const rawModels = catalog?.models ?? []

  const antigravityProjection = useMemo(
    () => (isAntigravity
      ? projectAntigravityModels(
          rawModels,
          defaultModel || catalog?.selectedModelId || rawModels[0]?.id || null,
          defaultEffort || null,
        )
      : null),
    [isAntigravity, rawModels, defaultModel, defaultEffort, catalog?.selectedModelId],
  )

  const modelOptions = useMemo(() => {
    if (isAntigravity) {
      return (antigravityProjection?.models ?? []).map((model) => ({
        id: model.id,
        name: model.name,
        description: model.description ?? '',
      }))
    }
    return rawModels.map((model) => ({
      id: model.id,
      name: model.name || model.id,
      description: model.description ?? '',
    }))
  }, [isAntigravity, antigravityProjection, rawModels])

  const modeEffortOptions = useMemo(() => {
    const modeCatalog = acpModeCatalog(catalog ? {
      modes: catalog.modes,
      modeConfigId: catalog.modeConfigId,
      selectedModeId: catalog.selectedModeId,
    } : null)
    return modeCatalog.efforts.map((opt) => ({
      value: opt.value,
      label: localizedEffortLabels[opt.value.toLowerCase()] ?? opt.label,
    }))
  }, [catalog, localizedEffortLabels])

  const useModelIdEfforts = Boolean(isAntigravity && antigravityProjection && antigravityProjection.effortOptions.length > 0)

  const effortOptions = useMemo(() => {
    if (useModelIdEfforts) {
      return (antigravityProjection?.effortOptions ?? []).map((opt) => ({
        value: opt.value,
        label: localizedEffortLabels[opt.value.toLowerCase()] ?? opt.label,
      }))
    }
    return modeEffortOptions
  }, [useModelIdEfforts, antigravityProjection, modeEffortOptions, localizedEffortLabels])

  async function save(
    patch: { defaultModel?: string; defaultEffort?: string },
    successMessage: string,
  ) {
    if (saving) return
    setSaving(true)
    try {
      const acpPatch = acpAgentPreferencePatch(resolvedAgentId, patch)
      await window.app.saveAppSettings({
        agentPreference: {
          acp: acpPatch,
        },
      })
      if (patch.defaultModel !== undefined) setDefaultModel(patch.defaultModel)
      if (patch.defaultEffort !== undefined) setDefaultEffort(patch.defaultEffort)
      void invalidateDefaultAcpPreferencesCache()
      toast.success(successMessage)
    } finally {
      setSaving(false)
    }
  }

  const disabled = loading || saving
  const selectedModelOption = modelOptions.find((m) => m.id === defaultModel)
  const currentModelLabel = selectedModelOption?.name || defaultModel || t('common.systemDefault')
  const selectedEffortOption = effortOptions.find((e) => e.value === defaultEffort)
  const currentEffortLabel = selectedEffortOption?.label
    || (defaultEffort
      ? (localizedEffortLabels[defaultEffort.toLowerCase()] ?? formatEffortOptionLabel(defaultEffort))
      : t('common.systemDefault'))

  return (
    <>
      <SettingsRow
        label={t('settings.preferences.defaultModel.label')}
        description={t('settings.preferences.defaultModel.description')}
      >
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={disabled}
              className={cn(
                settingsSelectTriggerClassName,
                defaultModel ? 'text-foreground' : 'text-muted-foreground',
                'hover:bg-accent',
              )}
            >
              <span className="truncate">{currentModelLabel}</span>
              <ChevronDown className={cn('size-3.5 shrink-0 transition-transform duration-200', modelOpen && 'rotate-180')} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-64 border-border bg-card p-1">
            <div className="flex items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
              <span className="min-w-0 flex-1">{t('settings.preferences.defaultModel.label')}</span>
              <IconButton
                size="xs"
                variant="nested"
                tooltip="Refresh models"
                disabled={catalogRefresh.modelsLoading}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  catalogRefresh.onRefreshModels?.()
                }}
              >
                <RefreshCw className={cn(catalogRefresh.modelsLoading && 'animate-spin')} />
              </IconButton>
            </div>
            <button
              onClick={() => {
                setModelOpen(false)
                void save({ defaultModel: '' }, t('settings.preferences.defaultModel.systemDefault'))
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                defaultModel === ''
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              {t('common.systemDefault')}
            </button>
            {modelOptions.map((model) => {
              const isSelected = defaultModel === model.id
              return (
                <button
                  key={model.id}
                  onClick={() => {
                    setModelOpen(false)
                    if (useModelIdEfforts && defaultEffort) {
                      const nextProj = projectAntigravityModels(rawModels, model.id, defaultEffort)
                      const supportsCurrentEffort = nextProj.effortOptions.some(
                        (opt) => opt.value === defaultEffort,
                      )
                      if (!supportsCurrentEffort) {
                        void save(
                          { defaultModel: model.id, defaultEffort: '' },
                          t('settings.preferences.defaultModel.updated'),
                        )
                        return
                      }
                    }
                    void save({ defaultModel: model.id }, t('settings.preferences.defaultModel.updated'))
                  }}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    isSelected
                      ? 'bg-muted text-foreground'
                      : 'text-foreground hover:bg-muted/50'
                  }`}
                >
                  <div className="font-medium">{model.name}</div>
                  {model.description && (
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{model.description}</div>
                  )}
                </button>
              )
            })}
          </PopoverContent>
        </Popover>
      </SettingsRow>

      <SettingsRow
        label={t('settings.preferences.reasoningEffort.label')}
        description={t('settings.preferences.reasoningEffort.description')}
      >
        <Popover open={effortOpen} onOpenChange={setEffortOpen}>
          <PopoverTrigger asChild>
            <button
              disabled={disabled || effortOptions.length === 0}
              className={cn(
                settingsSelectTriggerClassName,
                defaultEffort ? 'text-foreground' : 'text-muted-foreground',
                'hover:bg-accent',
              )}
            >
              <span className="truncate">{currentEffortLabel}</span>
              <ChevronDown className={cn('size-3.5 shrink-0 transition-transform duration-200', effortOpen && 'rotate-180')} />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="w-56 border-border bg-card p-1">
            <div className="px-2 py-1.5 text-xs text-muted-foreground">{t('settings.preferences.reasoningEffort.label')}</div>
            <button
              onClick={() => {
                setEffortOpen(false)
                void save({ defaultEffort: '' }, t('settings.preferences.reasoningEffort.systemDefault'))
              }}
              className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                defaultEffort === ''
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground'
              }`}
            >
              {t('common.systemDefault')}
            </button>
            {effortOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setEffortOpen(false)
                  void save({ defaultEffort: opt.value }, t('settings.preferences.reasoningEffort.updated'))
                }}
                className={`w-full rounded px-2 py-1.5 text-left text-xs transition-colors ${
                  opt.value === defaultEffort
                    ? 'bg-muted text-foreground font-medium'
                    : 'text-foreground hover:bg-muted/50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </SettingsRow>
    </>
  )
}

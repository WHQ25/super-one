import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DshSubagentModelSelection, ModelOption } from '@superone/shared/agent-types'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { Switch } from '@superone/ui/components/ui/switch'
import { SettingsRow, SettingsSubheader } from '@/components/settings/SettingsSection'

/** A route the agent may pick, as the picker lists it. */
export interface DshModelRoute {
  provider: string
  model: string
  name: string
}

const sameRoute = (a: { provider: string; model: string }, b: { provider: string; model: string }) =>
  a.provider === b.provider && a.model === b.model

/**
 * The DeepSeek subagent model preference, as rows of the preferences card
 * (a subheader opens the run, so it must render inside a `SettingsCard`).
 *
 * `value` and `models` are `null` while loading. The model list stays visible
 * but disabled while the preference is off, so turning it on never reveals a
 * choice the user did not see.
 */
export function DshSubagentModelsSection({ value, models, onChange }: {
  value: DshSubagentModelSelection | null
  models: DshModelRoute[] | null
  onChange: (next: DshSubagentModelSelection) => void
}) {
  const { t } = useTranslation()
  const loading = value === null
  const enabled = value?.enabled === true
  const allowed = value?.allowedModels ?? []

  const toggleModel = (route: DshModelRoute, checked: boolean) => {
    if (!value) return
    const rest = allowed.filter((entry) => !sameRoute(entry, route))
    onChange({ ...value, allowedModels: checked ? [...rest, { provider: route.provider, model: route.model }] : rest })
  }

  return (
    <>
      <SettingsSubheader>{t('settings.preferences.dshSubagentModels.section')}</SettingsSubheader>
      <SettingsRow
        label={t('settings.preferences.dshSubagentModels.label')}
        description={t('settings.preferences.dshSubagentModels.description')}
      >
        <Switch
          checked={enabled}
          disabled={loading}
          onCheckedChange={(checked) => value && onChange({ ...value, enabled: checked })}
          aria-label={t('settings.preferences.dshSubagentModels.label')}
        />
      </SettingsRow>
      <SettingsRow
        label={t('settings.preferences.dshSubagentModels.modelsLabel')}
        description={t('settings.preferences.dshSubagentModels.modelsDescription')}
        footer={(
          <>
            {models === null ? (
              <p className="text-xs text-muted-foreground">{t('settings.preferences.dshSubagentModels.loading')}</p>
            ) : models.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('settings.preferences.dshSubagentModels.empty')}</p>
            ) : (
              <ul className="space-y-2">
                {models.map((route) => {
                  const id = `dsh-subagent-model-${route.provider}-${route.model}`
                  return (
                    <li key={id} className="flex min-w-0 items-center gap-2">
                      <Checkbox
                        id={id}
                        checked={allowed.some((entry) => sameRoute(entry, route))}
                        disabled={loading || !enabled}
                        onCheckedChange={(checked) => toggleModel(route, checked === true)}
                      />
                      <label htmlFor={id} className="flex min-w-0 items-baseline gap-2 text-sm">
                        <span className="truncate">{route.name}</span>
                        <span className="truncate font-mono text-xs text-muted-foreground">{route.model}</span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
            {enabled && allowed.length === 0 && (
              <p className="mt-2 text-xs text-warning">{t('settings.preferences.dshSubagentModels.noneSelected')}</p>
            )}
          </>
        )}
      />
    </>
  )
}

/** Routes the picker offers, from the live DeepSeek catalog. */
export function dshModelRoutes(models: readonly ModelOption[]): DshModelRoute[] {
  return models.flatMap((option) => option.provider ? [{ provider: option.provider, model: option.id, name: option.name }] : [])
}

/** The section wired to app settings and the live DeepSeek catalog. */
export function DshSubagentModelsSettings() {
  const [value, setValue] = useState<DshSubagentModelSelection | null>(null)
  const [models, setModels] = useState<DshModelRoute[] | null>(null)

  useEffect(() => {
    let mounted = true
    void window.app.getAppSettings().then((settings) => {
      if (mounted) setValue(settings.dshSubagentModelSelection)
    })
    void window.app.connectDeepseek().then((resources) => {
      if (mounted) setModels(dshModelRoutes(resources.models))
    }, () => {
      if (mounted) setModels([])
    })
    return () => { mounted = false }
  }, [])

  const save = async (next: DshSubagentModelSelection) => {
    setValue(next)
    const saved = await window.app.saveAppSettings({ dshSubagentModelSelection: next })
    setValue(saved.dshSubagentModelSelection)
  }

  return <DshSubagentModelsSection value={value} models={models} onChange={(next) => void save(next)} />
}

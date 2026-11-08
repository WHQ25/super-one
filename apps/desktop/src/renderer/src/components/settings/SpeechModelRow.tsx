import { useEffect, useMemo } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { cn } from '@superone/ui/lib/utils'
import { ProviderOptionLabel } from '@/components/providers/DefaultProviderRow'
import { SettingsRow } from '@/components/settings/SettingsSection'
import { settingsSelectTriggerClassName } from '@/components/settings/select-trigger-class'
import { providerDisplayForCredential, selectedSpeechModel, speechModelGroups } from '@/lib/provider-resolve'
import { useSettingsStore } from '@/stores/settings'

/**
 * Speech model for read-aloud and speech generation.
 * Models are grouped by the provider account that enabled them.
 */
export function SpeechModelRow() {
  const { t } = useTranslation()
  const platforms = useSettingsStore((s) => s.platforms)
  const credentials = useSettingsStore((s) => s.credentials)
  const bindings = useSettingsStore((s) => s.bindings)
  const setBinding = useSettingsStore((s) => s.setBinding)
  const clearBinding = useSettingsStore((s) => s.clearBinding)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)

  useEffect(() => {
    void fetchProviderData()
  }, [fetchProviderData])

  const groups = useMemo(() => speechModelGroups(platforms, credentials), [platforms, credentials])
  const keysPerPlatform = useMemo(() => {
    const counts = new Map<string, number>()
    for (const group of groups) {
      counts.set(group.credential.platformId, (counts.get(group.credential.platformId) ?? 0) + 1)
    }
    return counts
  }, [groups])
  const binding = bindings.find((item) => item.consumer === 'tts')
  const current = selectedSpeechModel(groups, binding)
  const auto = <span className="truncate text-sm text-muted-foreground">{t('settings.general.speechProvider.auto')}</span>

  return (
    <SettingsRow
      label={t('settings.general.speechProvider.label')}
      description={t('settings.general.speechProvider.description')}
      className="break-words"
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={cn(settingsSelectTriggerClassName, 'max-w-72 shrink-0 gap-2 overflow-hidden')}>
            <span className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
              {current ? <span className="truncate">{current.modelName}</span> : auto}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
          <DropdownMenuItem onClick={() => { void clearBinding('tts') }} className="flex items-center justify-between gap-2">
            {auto}
            {!current && <Check className="size-4 shrink-0 text-muted-foreground" />}
          </DropdownMenuItem>
          {groups.map((group) => {
            const display = providerDisplayForCredential(platforms, group.credential)
            return (
              <DropdownMenuGroup key={group.credential.id}>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  <ProviderOptionLabel
                    brandKey={display.brand}
                    name={display.name}
                    icon={display.icon}
                    keyName={(keysPerPlatform.get(group.credential.platformId) ?? 0) > 1 ? group.credential.name : undefined}
                  />
                </DropdownMenuLabel>
                {group.models.map((model) => {
                  const selected = current?.credential.id === group.credential.id && current.modelId === model.id
                  return (
                    <DropdownMenuItem
                      key={model.id}
                      onClick={() => {
                        void setBinding({
                          consumer: 'tts',
                          credentialId: group.credential.id,
                          config: { modelId: model.id },
                        })
                      }}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">{model.name}</span>
                      {selected && <Check className="size-4 shrink-0 text-muted-foreground" />}
                    </DropdownMenuItem>
                  )
                })}
              </DropdownMenuGroup>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsRow>
  )
}

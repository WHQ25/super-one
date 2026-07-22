import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Textarea } from '@superone/ui/components/ui/textarea'
import type { ConfigConfirmField, ProviderModelEnv } from '@superone/shared/agent-types'
import {
  findEndpoint,
  findPlan,
  findPlatform,
  planCapabilities,
  type EndpointModel,
  type PlanCapabilities,
} from '@superone/shared/platform-registry'
import { useSettingsStore } from '@/stores/settings'
import { CapabilityField, TASK_LABEL_KEY } from '../providers/CapabilityPicker'
import { EnvEditor, ModelEnvEditor } from '../providers/CredentialConfig'
import { AddCustomModelPopover, endpointsSupportedTasks } from '../providers/custom-models'

export interface StructuredSettingFieldProps {
  field: ConfigConfirmField
  value: unknown
  onChange: (value: unknown) => void
}

function asMap<T>(value: unknown): Record<string, T> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, T>) : {}
}

function asModels(value: unknown): EndpointModel[] {
  return Array.isArray(value) ? (value as EndpointModel[]) : []
}

/**
 * Resolve the real Platform/Plan/ServiceEndpoint a structured field targets. The confirm dialog lives in
 * the chat panel, which may never have opened Settings, so the provider data is fetched on demand.
 */
function useFieldTarget(context: ConfigConfirmField['context']) {
  const platforms = useSettingsStore((s) => s.platforms)
  const fetchProviderData = useSettingsStore((s) => s.fetchProviderData)

  useEffect(() => {
    if (platforms.length === 0) void fetchProviderData()
  }, [platforms.length, fetchProviderData])

  return useMemo(() => {
    const platform = context?.platformId ? findPlatform(platforms, context.platformId) : undefined
    const plan = context?.planId ? findPlan(platform, context.planId) : platform?.plans[0]
    const endpoint = context?.endpointId ? findEndpoint(plan, context.endpointId) : plan?.endpoints[0]
    return { platform, plan, endpoint }
  }, [platforms, context?.platformId, context?.planId, context?.endpointId])
}

function ModelsField({ field, value, onChange }: StructuredSettingFieldProps) {
  const { t } = useTranslation()
  const { plan, endpoint } = useFieldTarget(field.context)
  const models = asModels(value)
  const supportedTasks = useMemo(
    () => endpointsSupportedTasks(endpoint ? [endpoint] : (plan?.endpoints ?? [])),
    [endpoint, plan],
  )

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-muted-foreground">
          {t('chat.configConfirm.modelCount', { count: models.length })}
        </span>
        {supportedTasks.length > 0 && (
          <AddCustomModelPopover
            supportedTasks={supportedTasks}
            existingIds={models.map((m) => m.id)}
            onAdd={(m) => onChange([...models, { id: m.id, ...(m.name ? { name: m.name } : {}), tasks: m.tasks }])}
          />
        )}
      </div>
      {models.map((m) => (
        <div key={m.id} className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5">
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{m.name || m.id}</span>
          {m.tasks && m.tasks.length > 0 && (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {m.tasks.map((task) => t(TASK_LABEL_KEY[task])).join(' / ')}
            </span>
          )}
          <IconButton size="sm" variant="destructive" onClick={() => onChange(models.filter((x) => x.id !== m.id))}>
            <Trash2 />
          </IconButton>
        </div>
      ))}
    </div>
  )
}

function CapabilitiesField({ field, value, onChange }: StructuredSettingFieldProps) {
  const { plan } = useFieldTarget(field.context)
  const caps = useMemo<PlanCapabilities>(() => {
    const v = value as PlanCapabilities | undefined
    if (v?.families) return v
    return plan ? planCapabilities(plan) : { families: [], tasks: {}, extras: {} }
  }, [value, plan])
  return <CapabilityField value={caps} onChange={onChange} />
}

/**
 * Renderer for the structured config field types. Each one delegates to the exact editor the AI Provider
 * settings page uses, so a proposal from the agent is reviewed through the same UI the user would edit it in.
 */
export function StructuredSettingField(props: StructuredSettingFieldProps) {
  const { field, value, onChange } = props
  switch (field.type) {
    case 'env':
      return <EnvEditor value={asMap<string>(value)} onChange={onChange} />
    case 'model-mapping':
      return <ModelEnvEditor value={asMap<ProviderModelEnv[keyof ProviderModelEnv]>(value) as ProviderModelEnv} onChange={onChange} />
    case 'models':
      return <ModelsField {...props} />
    case 'capabilities':
      return <CapabilitiesField {...props} />
    default:
      return (
        <Textarea
          value={value === null || value === undefined ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          className="w-full font-mono text-xs"
        />
      )
  }
}

const STRUCTURED_TYPES = new Set(['json', 'env', 'model-mapping', 'models', 'capabilities'])

export function isStructuredFieldType(type: ConfigConfirmField['type']): boolean {
  return STRUCTURED_TYPES.has(type)
}

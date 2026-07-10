import { useState } from 'react'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Input } from '@superone/ui/components/ui/input'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import { cn } from '@superone/ui/lib/utils'
import {
  endpointServes,
  endpointTasks,
  type EndpointOverride,
  type Plan,
  type ServiceEndpoint,
} from '@superone/shared/platform-registry'
import type { CapabilityTask } from '@superone/shared/agent-types'
import { MODEL_TASK_ORDER } from '@superone/shared/model-tasks'

export type CustomModel = { id: string; name?: string; tasks: CapabilityTask[] }

/** Plan endpoints that serve any of the given tasks — a custom model is written to each. */
export function endpointsForTasks(plan: Plan, tasks: CapabilityTask[]): ServiceEndpoint[] {
  return plan.endpoints.filter((e) => tasks.some((t) => endpointServes(e, t)))
}

/** Tasks (chat/image/…) the plan's endpoints can actually serve, in canonical order. */
export function endpointsSupportedTasks(endpoints: ServiceEndpoint[]): CapabilityTask[] {
  const set = new Set<CapabilityTask>()
  for (const e of endpoints) for (const t of endpointTasks(e)) set.add(t)
  return MODEL_TASK_ORDER.filter((t) => set.has(t))
}

export function planSupportedTasks(plan: Plan): CapabilityTask[] {
  return endpointsSupportedTasks(plan.endpoints)
}

function cleanOverride(ov: EndpointOverride): EndpointOverride | undefined {
  const next: EndpointOverride = { ...ov }
  if (!next.models || next.models.length === 0) delete next.models
  return Object.keys(next).length > 0 ? next : undefined
}

function dropModel(overrides: Record<string, EndpointOverride>, id: string): Record<string, EndpointOverride> {
  const next: Record<string, EndpointOverride> = { ...overrides }
  for (const [epId, ov] of Object.entries(next)) {
    if (!ov.models?.some((m) => m.id === id)) continue
    const cleaned = cleanOverride({ ...ov, models: ov.models.filter((m) => m.id !== id) })
    if (cleaned) next[epId] = cleaned
    else delete next[epId]
  }
  return next
}

/**
 * Add or replace a user-defined model across the plan endpoints serving its tasks. The prior
 * entry is removed everywhere first (its task set may have changed → a different endpoint set),
 * then re-added, storing per endpoint only the intersection of tasks that endpoint serves.
 */
export function upsertCustomModel(
  overrides: Record<string, EndpointOverride> | undefined,
  plan: Plan,
  model: CustomModel,
): Record<string, EndpointOverride> {
  const id = model.id.trim()
  const name = model.name?.trim() || undefined
  let next: Record<string, EndpointOverride> = { ...(overrides ?? {}) }
  if (!id || model.tasks.length === 0) return next
  next = dropModel(next, id)
  for (const ep of endpointsForTasks(plan, model.tasks)) {
    const tasks = model.tasks.filter((t) => endpointServes(ep, t))
    if (tasks.length === 0) continue
    const ov = next[ep.id] ?? {}
    next[ep.id] = { ...ov, models: [...(ov.models ?? []), { id, name, tasks }] }
  }
  return next
}

export function removeCustomModel(
  overrides: Record<string, EndpointOverride> | undefined,
  id: string,
): Record<string, EndpointOverride> {
  return dropModel({ ...(overrides ?? {}) }, id)
}

/**
 * User-added models across all endpoints, deduped by id with their tasks unioned. `isCatalogModel`
 * excludes ids that come from the resolved catalog pool (those are toggled, not custom).
 */
export function listCustomModels(
  overrides: Record<string, EndpointOverride> | undefined,
  isCatalogModel?: (endpointId: string, modelId: string) => boolean,
): CustomModel[] {
  const byId = new Map<string, { id: string; name?: string; tasks: Set<CapabilityTask> }>()
  for (const [epId, ov] of Object.entries(overrides ?? {})) {
    for (const m of ov.models ?? []) {
      if (isCatalogModel?.(epId, m.id)) continue
      const cur = byId.get(m.id) ?? { id: m.id, name: m.name, tasks: new Set<CapabilityTask>() }
      if (!cur.name && m.name) cur.name = m.name
      for (const t of m.tasks ?? []) cur.tasks.add(t)
      byId.set(m.id, cur)
    }
  }
  return [...byId.values()].map((x) => ({ id: x.id, name: x.name, tasks: [...x.tasks] }))
}

export function AddCustomModelPopover({
  supportedTasks,
  existingIds = [],
  onAdd,
  className,
}: {
  supportedTasks: CapabilityTask[]
  existingIds?: string[]
  onAdd: (model: CustomModel) => void
  className?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [tasks, setTasks] = useState<Set<CapabilityTask>>(() => new Set())

  const trimmedId = id.trim()
  const duplicate = !!trimmedId && existingIds.some((x) => x === trimmedId)
  const canAdd = !!trimmedId && tasks.size > 0 && !duplicate

  const reset = () => {
    setId('')
    setName('')
    setTasks(new Set())
  }

  const close = () => {
    reset()
    setOpen(false)
  }

  const submit = () => {
    if (!canAdd) return
    onAdd({ id: trimmedId, name: name.trim() || undefined, tasks: [...tasks] })
    close()
  }

  const toggleTask = (task: CapabilityTask, checked: boolean) => {
    setTasks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(task)
      else next.delete(task)
      return next
    })
  }

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (v) {
          setOpen(true)
          if (supportedTasks.length === 1) setTasks(new Set(supportedTasks))
        } else close()
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('h-7 text-xs', className)}>
          <Plus className="size-3.5" /> {t('resources.providerDialog.models.addCustom')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2.5">
        <Input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder={t('resources.providerDialog.modelIdPlaceholder')}
          className="font-mono text-xs"
          autoFocus
        />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('resources.providerDialog.modelNamePlaceholder')}
          className="text-xs"
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('resources.providerDialog.models.usedFor')}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {supportedTasks.map((task) => (
              <label key={task} className="flex items-center gap-2 text-xs">
                <Checkbox checked={tasks.has(task)} onCheckedChange={(v) => toggleTask(task, v === true)} />
                {t(`resources.providerDialog.models.${task}`)}
              </label>
            ))}
          </div>
        </div>
        {duplicate && <span className="text-[11px] text-destructive">{t('resources.providerDialog.models.duplicate')}</span>}
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={close}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" className="h-7 text-xs" disabled={!canAdd} onClick={submit}>
            {t('resources.providerDialog.models.add')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

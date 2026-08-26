import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Input } from '@superone/ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@superone/ui/components/ui/select'
import type { CapabilityTask } from '@superone/shared/agent-types'
import { isVideoWire, type EndpointSlot } from '@superone/shared/platform-registry'
import { MODEL_TASK_ORDER } from '@superone/shared/model-tasks'
import { PROTOCOL_LABEL_KEY } from './protocol-labels'

export interface ModelEditPatch {
  name: string
  tasks: CapabilityTask[]
  slots: Partial<Record<CapabilityTask, EndpointSlot>>
}

/** A wire slot reads as its protocol; a family slot is the shared endpoint and has no better name. */
function slotLabel(slot: EndpointSlot, t: (k: string) => string): string {
  return isVideoWire(slot) ? t(PROTOCOL_LABEL_KEY[slot]) : slot
}

export function EditDiscoveredModelPopover({
  name,
  tasks,
  slots,
  slotOptions,
  onSave,
}: {
  name: string
  tasks: CapabilityTask[]
  /** Which endpoint currently serves each task. */
  slots?: Partial<Record<CapabilityTask, EndpointSlot>>
  /** Endpoints this key could serve each task with. A task with fewer than two shows no picker. */
  slotOptions?: Partial<Record<CapabilityTask, EndpointSlot[]>>
  onSave: (next: ModelEditPatch) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [draftTasks, setDraftTasks] = useState<Set<CapabilityTask>>(() => new Set(tasks))
  const [draftSlots, setDraftSlots] = useState<Partial<Record<CapabilityTask, EndpointSlot>>>(() => ({ ...slots }))
  const canSave = draftTasks.size > 0

  const toggleTask = (task: CapabilityTask, checked: boolean) => {
    setDraftTasks((prev) => {
      const next = new Set(prev)
      if (checked) next.add(task)
      else next.delete(task)
      return next
    })
  }

  // Only a task with a real choice gets a picker — one endpoint means there is nothing to decide.
  const pickable = MODEL_TASK_ORDER.filter(
    (task) => draftTasks.has(task) && (slotOptions?.[task]?.length ?? 0) > 1,
  )

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (v) {
          setDraftName(name)
          setDraftTasks(new Set(tasks))
          setDraftSlots({ ...slots })
        }
      }}
    >
      <PopoverTrigger asChild>
        <IconButton size="sm" tooltip={t('resources.providerDialog.models.editModel')}>
          <Settings2 />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-72 flex-col gap-2.5">
        <Input
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          placeholder={t('resources.providerDialog.modelNamePlaceholder')}
          className="text-xs"
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t('resources.providerDialog.models.usedFor')}</span>
          <div className="grid grid-cols-2 gap-1.5">
            {MODEL_TASK_ORDER.map((task) => (
              <label key={task} className="flex items-center gap-2 text-xs">
                <Checkbox checked={draftTasks.has(task)} onCheckedChange={(v) => toggleTask(task, v === true)} />
                {t(`resources.providerDialog.models.${task}`)}
              </label>
            ))}
          </div>
        </div>

        {pickable.map((task) => {
          const options = slotOptions?.[task] ?? []
          return (
            <div key={task} className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t('resources.providerDialog.models.endpointFor', {
                  task: t(`resources.providerDialog.models.${task}`),
                })}
              </span>
              <Select
                value={draftSlots[task] ?? options[0]}
                onValueChange={(v) => setDraftSlots((prev) => ({ ...prev, [task]: v as EndpointSlot }))}
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {options.map((slot) => (
                    <SelectItem key={slot} value={slot} className="text-xs">
                      {slotLabel(slot, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )
        })}

        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!canSave}
            onClick={() => {
              // Only pinned tasks that are still selected are sent; a task the user unticked must not
              // resurrect its endpoint pin the next time it is enabled.
              const slots: Partial<Record<CapabilityTask, EndpointSlot>> = {}
              for (const task of draftTasks) {
                const pinned = draftSlots[task]
                if (pinned) slots[task] = pinned
              }
              onSave({ name: draftName, tasks: [...draftTasks], slots })
              setOpen(false)
            }}
          >
            {t('common.save')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

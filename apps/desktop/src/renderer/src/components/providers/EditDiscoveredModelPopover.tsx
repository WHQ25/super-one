import { useState } from 'react'
import { Settings2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Input } from '@superone/ui/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@superone/ui/components/ui/popover'
import type { CapabilityTask } from '@superone/shared/agent-types'
import { MODEL_TASK_ORDER } from '@superone/shared/model-tasks'

export function EditDiscoveredModelPopover({
  name,
  tasks,
  onSave,
}: {
  name: string
  tasks: CapabilityTask[]
  onSave: (next: { name: string; tasks: CapabilityTask[] }) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftName, setDraftName] = useState(name)
  const [draftTasks, setDraftTasks] = useState<Set<CapabilityTask>>(() => new Set(tasks))
  const canSave = draftTasks.size > 0

  const toggleTask = (task: CapabilityTask, checked: boolean) => {
    setDraftTasks((prev) => {
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
        setOpen(v)
        if (v) {
          setDraftName(name)
          setDraftTasks(new Set(tasks))
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
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            disabled={!canSave}
            onClick={() => {
              onSave({ name: draftName, tasks: [...draftTasks] })
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

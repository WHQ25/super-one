import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import {
  FAMILY_EXTRA_PROTOCOLS,
  FAMILY_TASKS,
  PROTOCOL_FAMILIES,
  type CapabilityTask,
  type PlanCapabilities,
  type ProtocolFamily,
  type WireProtocol,
} from '@superone/shared/platform-registry'

const FAMILY_LABEL_KEY: Record<ProtocolFamily, string> = {
  anthropic: 'resources.providers.familyAnthropic',
  openai: 'resources.providers.familyOpenai',
  newapi: 'resources.providers.familyNewapi',
  google: 'resources.providers.familyGoogle',
}

// Labels for opt-in extra wires (FAMILY_EXTRA_PROTOCOLS) rendered alongside a family's capability tasks.
const PROTOCOL_LABEL_KEY: Partial<Record<WireProtocol, string>> = {
  'openai-responses': 'resources.providers.protocolOpenaiResponses',
}

// Per-family task label overrides — OpenAI's chat task is the "Chat Completion" wire (paired with the
// "Chat Response" extra wire), whereas other families keep the generic TASK_LABEL_KEY.
const FAMILY_TASK_LABEL: Partial<Record<ProtocolFamily, Partial<Record<CapabilityTask, string>>>> = {
  openai: { chat: 'resources.providers.protocolOpenaiChatCompletion' },
}

export const TASK_LABEL_KEY: Record<CapabilityTask, string> = {
  chat: 'resources.providers.taskChat',
  image: 'resources.providers.taskImage',
  video: 'resources.providers.taskVideo',
  tts: 'resources.providers.taskTts',
  asr: 'resources.providers.taskAsr',
}

export type CapabilitySelection = {
  families: Set<ProtocolFamily>
  familyTasks: Record<ProtocolFamily, Set<CapabilityTask>>
  familyExtras: Record<ProtocolFamily, Set<WireProtocol>>
}

/** The tasks a newly-checked family starts with — chat when it can serve it, everything it can otherwise. */
function defaultTasks(family: ProtocolFamily): CapabilityTask[] {
  return FAMILY_TASKS[family].includes('chat') ? ['chat'] : FAMILY_TASKS[family]
}

function toSelection(value: PlanCapabilities): CapabilitySelection {
  const familyTasks = {} as Record<ProtocolFamily, Set<CapabilityTask>>
  const familyExtras = {} as Record<ProtocolFamily, Set<WireProtocol>>
  for (const f of PROTOCOL_FAMILIES) {
    familyTasks[f] = new Set(value.families.includes(f) ? (value.tasks[f] ?? []) : defaultTasks(f))
    familyExtras[f] = new Set(value.extras[f] ?? [])
  }
  return { families: new Set(value.families), familyTasks, familyExtras }
}

export function toPlanCapabilities({ families, familyTasks, familyExtras }: CapabilitySelection): PlanCapabilities {
  const selected = PROTOCOL_FAMILIES.filter((f) => families.has(f))
  const tasks: Partial<Record<ProtocolFamily, CapabilityTask[]>> = {}
  const extras: Partial<Record<ProtocolFamily, WireProtocol[]>> = {}
  for (const f of selected) {
    tasks[f] = FAMILY_TASKS[f].filter((t) => familyTasks[f].has(t))
    const picked = FAMILY_EXTRA_PROTOCOLS[f].filter((p) => familyExtras[f].has(p))
    if (picked.length > 0) extras[f] = picked
  }
  return { families: selected, tasks, extras }
}

/**
 * Format + per-family capability/extra-wire selection state, shared by the create form and the post-create
 * editor. A family's task set is seeded from `initial` when that family is present in the plan (empty is
 * honored — e.g. an OpenAI endpoint speaking only Responses), otherwise it defaults to chat so a
 * newly-checked format behaves like the create dialog.
 */
export function useCapabilityState(initial?: PlanCapabilities) {
  const seed = useMemo(() => toSelection(initial ?? { families: ['anthropic'], tasks: {}, extras: {} }), [initial])
  const [families, setFamilies] = useState<Set<ProtocolFamily>>(seed.families)
  const [familyTasks, setFamilyTasks] = useState<Record<ProtocolFamily, Set<CapabilityTask>>>(seed.familyTasks)
  const [familyExtras, setFamilyExtras] = useState<Record<ProtocolFamily, Set<WireProtocol>>>(seed.familyExtras)

  const toggleFamily = useCallback((family: ProtocolFamily, checked: boolean) => {
    setFamilies((prev) => {
      const next = new Set(prev)
      if (checked) next.add(family)
      else next.delete(family)
      return next
    })
  }, [])

  const toggleTask = useCallback((family: ProtocolFamily, task: CapabilityTask, checked: boolean) => {
    setFamilyTasks((prev) => {
      const next = new Set(prev[family])
      if (checked) next.add(task)
      else next.delete(task)
      return { ...prev, [family]: next }
    })
  }, [])

  const toggleExtra = useCallback((family: ProtocolFamily, protocol: WireProtocol, checked: boolean) => {
    setFamilyExtras((prev) => {
      const next = new Set(prev[family])
      if (checked) next.add(protocol)
      else next.delete(protocol)
      return { ...prev, [family]: next }
    })
  }, [])

  const selection: CapabilitySelection = { families, familyTasks, familyExtras }
  return { families, familyTasks, familyExtras, selection, toggleFamily, toggleTask, toggleExtra }
}

/**
 * Formats checkbox group + a nested picker (capability tasks + opt-in extra wires) for every selected family
 * that has more than one thing to pick.
 */
export function CapabilityPicker({
  families,
  familyTasks,
  familyExtras,
  onToggleFamily,
  onToggleTask,
  onToggleExtra,
}: CapabilitySelection & {
  onToggleFamily: (family: ProtocolFamily, checked: boolean) => void
  onToggleTask: (family: ProtocolFamily, task: CapabilityTask, checked: boolean) => void
  onToggleExtra: (family: ProtocolFamily, protocol: WireProtocol, checked: boolean) => void
}) {
  const { t } = useTranslation()
  const pickerFamilies = PROTOCOL_FAMILIES.filter(
    (f) => families.has(f) && (FAMILY_TASKS[f].length > 1 || FAMILY_EXTRA_PROTOCOLS[f].length > 0),
  )
  return (
    <>
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <span className="text-xs text-muted-foreground">{t('resources.providers.formats')}</span>
        {PROTOCOL_FAMILIES.map((f) => (
          <label key={f} className="flex items-center gap-2 text-sm">
            <Checkbox checked={families.has(f)} onCheckedChange={(v) => onToggleFamily(f, v === true)} />
            {t(FAMILY_LABEL_KEY[f])}
          </label>
        ))}
      </div>
      {pickerFamilies.map((f) => (
        <div key={f} className="flex flex-col gap-2 rounded-md border border-border p-3">
          <span className="text-xs text-muted-foreground">{t(FAMILY_LABEL_KEY[f])}</span>
          <div className="grid grid-cols-2 gap-2">
            {FAMILY_EXTRA_PROTOCOLS[f].map((protocol) => (
              <label key={protocol} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox
                  checked={familyExtras[f].has(protocol)}
                  onCheckedChange={(v) => onToggleExtra(f, protocol, v === true)}
                />
                {t(PROTOCOL_LABEL_KEY[protocol] ?? protocol)}
              </label>
            ))}
            {FAMILY_TASKS[f].map((task) => (
              <label key={task} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Checkbox checked={familyTasks[f].has(task)} onCheckedChange={(v) => onToggleTask(f, task, v === true)} />
                {t(FAMILY_TASK_LABEL[f]?.[task] ?? TASK_LABEL_KEY[task])}
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

/** Fully controlled variant for consumers that already own a PlanCapabilities value (e.g. the config confirm dialog). */
export function CapabilityField({ value, onChange }: { value: PlanCapabilities; onChange: (v: PlanCapabilities) => void }) {
  const selection = toSelection(value)
  const emit = (next: CapabilitySelection): void => onChange(toPlanCapabilities(next))
  return (
    <CapabilityPicker
      {...selection}
      onToggleFamily={(family, checked) => {
        const families = new Set(selection.families)
        if (checked) families.add(family)
        else families.delete(family)
        emit({ ...selection, families })
      }}
      onToggleTask={(family, task, checked) => {
        const tasks = new Set(selection.familyTasks[family])
        if (checked) tasks.add(task)
        else tasks.delete(task)
        emit({ ...selection, familyTasks: { ...selection.familyTasks, [family]: tasks } })
      }}
      onToggleExtra={(family, protocol, checked) => {
        const extras = new Set(selection.familyExtras[family])
        if (checked) extras.add(protocol)
        else extras.delete(protocol)
        emit({ ...selection, familyExtras: { ...selection.familyExtras, [family]: extras } })
      }}
    />
  )
}

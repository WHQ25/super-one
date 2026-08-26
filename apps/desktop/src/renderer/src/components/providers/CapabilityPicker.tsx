import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import {
  CAPABILITY_ORDER,
  FAMILY_PROTOCOLS,
  PROTOCOL_FAMILIES,
  PROTOCOL_TASKS,
  protocolRoute,
  type CapabilityTask,
  type PlanCapabilities,
  type ProtocolFamily,
  type WireProtocol,
} from '@superone/shared/platform-registry'
import { FAMILY_LABEL_KEY, PROTOCOL_LABEL_KEY } from './protocol-labels'

export const TASK_LABEL_KEY: Record<CapabilityTask, string> = {
  chat: 'resources.providers.taskChat',
  image: 'resources.providers.taskImage',
  video: 'resources.providers.taskVideo',
  tts: 'resources.providers.taskTts',
  asr: 'resources.providers.taskAsr',
}

export type CapabilitySelection = { protocols: Set<WireProtocol> }

export function toPlanCapabilities({ protocols }: CapabilitySelection): PlanCapabilities {
  return { protocols: PROTOCOL_FAMILIES.flatMap((f) => FAMILY_PROTOCOLS[f]).filter((p) => protocols.has(p)) }
}

/** Protocol selection state, shared by the create form and the post-create editor. */
export function useCapabilityState(initial?: PlanCapabilities) {
  const seed = useMemo(() => new Set(initial?.protocols ?? (['anthropic-messages'] as WireProtocol[])), [initial])
  const [protocols, setProtocols] = useState<Set<WireProtocol>>(seed)

  const toggleProtocol = useCallback((protocol: WireProtocol, checked: boolean) => {
    setProtocols((prev) => {
      const next = new Set(prev)
      if (checked) next.add(protocol)
      else next.delete(protocol)
      return next
    })
  }, [])

  const selection: CapabilitySelection = { protocols }
  return { protocols, selection, toggleProtocol }
}

/**
 * Wire-protocol checkboxes, grouped by the vendor that defined each protocol.
 *
 * One control, one concept: a protocol is either spoken or it is not. What it can *do* is a property
 * of the protocol (`PROTOCOL_TASKS`), shown as tags rather than asked for — an earlier version made
 * the user pick capabilities and reverse-derived the protocol, which needed a second mechanism the
 * moment one capability had two wires (video).
 */
export function CapabilityPicker({
  protocols,
  onToggleProtocol,
}: CapabilitySelection & {
  onToggleProtocol: (protocol: WireProtocol, checked: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border p-3">
      <span className="text-xs text-muted-foreground">{t('resources.providers.formats')}</span>
      {PROTOCOL_FAMILIES.map((family) => (
        <div key={family} className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">{t(FAMILY_LABEL_KEY[family])}</span>
          {FAMILY_PROTOCOLS[family].map((protocol) => (
            <label key={protocol} className="flex items-center gap-2 pl-1 text-sm">
              <Checkbox
                checked={protocols.has(protocol)}
                onCheckedChange={(v) => onToggleProtocol(protocol, v === true)}
              />
              <span>{t(PROTOCOL_LABEL_KEY[protocol])}</span>
              <span className="font-mono text-[10px] text-muted-foreground/70">{protocolRoute(protocol)}</span>
              <span className="ml-auto flex gap-1">
                {CAPABILITY_ORDER.filter((task) => PROTOCOL_TASKS[protocol].includes(task)).map((task) => (
                  <span key={task} className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                    {t(TASK_LABEL_KEY[task])}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

/** Fully controlled variant for consumers that already own a PlanCapabilities value (e.g. the config confirm dialog). */
export function CapabilityField({ value, onChange }: { value: PlanCapabilities; onChange: (v: PlanCapabilities) => void }) {
  const protocols = new Set(value.protocols)
  return (
    <CapabilityPicker
      protocols={protocols}
      onToggleProtocol={(protocol, checked) => {
        const next = new Set(protocols)
        if (checked) next.add(protocol)
        else next.delete(protocol)
        onChange(toPlanCapabilities({ protocols: next }))
      }}
    />
  )
}

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Plus } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import type { PresetSyncDiff } from '@/lib/preset-merge'

type Selection = Record<string, boolean>

function buildDefaultSelection(diff: PresetSyncDiff | null): Selection {
  const sel: Selection = {}
  if (!diff) return sel
  for (const agentDiff of diff.perAgent) {
    for (const k of Object.keys(agentDiff.extraEnvAdded)) sel[`${agentDiff.agent}:extra_add:${k}`] = true
    for (const c of agentDiff.extraEnvChanged) sel[`${agentDiff.agent}:extra_change:${c.key}`] = false
    for (const k of Object.keys(agentDiff.modelEnvSlotsAdded)) sel[`${agentDiff.agent}:model_add:${k}`] = true
    for (const c of agentDiff.modelEnvSlotsChanged) sel[`${agentDiff.agent}:model_change:${c.slot}`] = false
    if (agentDiff.baseUrlMismatch) sel[`${agentDiff.agent}:base_url`] = false
  }
  for (const a of diff.supportedAgentsAdded) sel[`supported_agent:${a}`] = true
  return sel
}

function buildEffectiveDiff(diff: PresetSyncDiff, selection: Selection): PresetSyncDiff {
  const perAgent = diff.perAgent.map((ad) => {
    const extraEnvAdded: Record<string, string> = {}
    for (const [k, v] of Object.entries(ad.extraEnvAdded)) {
      if (selection[`${ad.agent}:extra_add:${k}`]) extraEnvAdded[k] = v
    }
    const extraEnvChanged = ad.extraEnvChanged.filter((c) => selection[`${ad.agent}:extra_change:${c.key}`])
    const modelEnvSlotsAdded: typeof ad.modelEnvSlotsAdded = {}
    for (const [k, v] of Object.entries(ad.modelEnvSlotsAdded)) {
      if (selection[`${ad.agent}:model_add:${k}`]) modelEnvSlotsAdded[k as keyof typeof modelEnvSlotsAdded] = v
    }
    const modelEnvSlotsChanged = ad.modelEnvSlotsChanged.filter((c) => selection[`${ad.agent}:model_change:${c.slot}`])
    const baseUrlMismatch = ad.baseUrlMismatch && selection[`${ad.agent}:base_url`] ? ad.baseUrlMismatch : undefined
    return { agent: ad.agent, extraEnvAdded, extraEnvChanged, modelEnvSlotsAdded, modelEnvSlotsChanged, baseUrlMismatch }
  }).filter((ad) =>
    Object.keys(ad.extraEnvAdded).length > 0
    || ad.extraEnvChanged.length > 0
    || Object.keys(ad.modelEnvSlotsAdded).length > 0
    || ad.modelEnvSlotsChanged.length > 0
    || ad.baseUrlMismatch,
  )
  const supportedAgentsAdded = diff.supportedAgentsAdded.filter((a) => selection[`supported_agent:${a}`])
  return {
    presetKey: diff.presetKey,
    presetName: diff.presetName,
    perAgent,
    supportedAgentsAdded,
    hasChanges: perAgent.length > 0 || supportedAgentsAdded.length > 0,
  }
}

export function PresetSyncDialog({
  open,
  onOpenChange,
  diff,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  diff: PresetSyncDiff | null
  onApply: (effectiveDiff: PresetSyncDiff) => void
}) {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<Selection>(() => buildDefaultSelection(diff))

  useEffect(() => {
    if (open) setSelection(buildDefaultSelection(diff))
  }, [open, diff])

  if (!diff) return null

  const setKey = (key: string, val: boolean) => setSelection((prev) => ({ ...prev, [key]: val }))
  const selectedCount = Object.values(selection).filter(Boolean).length

  const slotLabel = (slot: string) => {
    if (slot === 'default') return t('resources.providerDialog.bucketDefault')
    if (slot === 'subagent') return t('resources.providerDialog.bucketSubagent')
    return slot.charAt(0).toUpperCase() + slot.slice(1)
  }

  const renderEmpty = (v: string) => v === '' ? t('resources.providerDialog.syncEmptyPlaceholder') : v

  const handleApply = () => {
    onApply(buildEffectiveDiff(diff, selection))
  }

  const showEmpty = !diff.hasChanges
    || (diff.perAgent.length === 0 && diff.supportedAgentsAdded.length === 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('resources.providerDialog.syncTitle', { name: diff.presetName })}</DialogTitle>
          <DialogDescription>{t('resources.providerDialog.syncDescription')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-96 space-y-4 overflow-y-auto py-2 pr-1">
          {showEmpty && (
            <p className="text-sm text-muted-foreground">{t('resources.providerDialog.syncNoChanges')}</p>
          )}

          {diff.supportedAgentsAdded.length > 0 && (
            <Section title={t('resources.providerDialog.syncSupportedAgentsAdded')}>
              {diff.supportedAgentsAdded.map((a) => (
                <AddedRow
                  key={a}
                  id={`supported_agent:${a}`}
                  selection={selection}
                  setKey={setKey}
                  label={a}
                  value={null}
                />
              ))}
            </Section>
          )}

          {diff.perAgent.map((agentDiff) => (
            <div key={agentDiff.agent} className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{agentDiff.agent}</div>

              {agentDiff.baseUrlMismatch && (
                <Section title={t('resources.providerDialog.syncBaseUrlSection')}>
                  <ChangedRow
                    id={`${agentDiff.agent}:base_url`}
                    selection={selection}
                    setKey={setKey}
                    label="Base URL"
                    from={agentDiff.baseUrlMismatch.current}
                    to={agentDiff.baseUrlMismatch.preset}
                  />
                </Section>
              )}

              {(Object.keys(agentDiff.extraEnvAdded).length > 0 || agentDiff.extraEnvChanged.length > 0) && (
                <Section title={t('resources.providerDialog.syncExtraEnvSection')}>
                  {Object.entries(agentDiff.extraEnvAdded).map(([k, v]) => (
                    <AddedRow
                      key={`extra-add-${k}`}
                      id={`${agentDiff.agent}:extra_add:${k}`}
                      selection={selection}
                      setKey={setKey}
                      label={k}
                      value={renderEmpty(v)}
                    />
                  ))}
                  {agentDiff.extraEnvChanged.map((c) => (
                    <ChangedRow
                      key={`extra-change-${c.key}`}
                      id={`${agentDiff.agent}:extra_change:${c.key}`}
                      selection={selection}
                      setKey={setKey}
                      label={c.key}
                      from={renderEmpty(c.from)}
                      to={renderEmpty(c.to)}
                    />
                  ))}
                </Section>
              )}

              {(Object.keys(agentDiff.modelEnvSlotsAdded).length > 0 || agentDiff.modelEnvSlotsChanged.length > 0) && (
                <Section title={t('resources.providerDialog.syncModelEnvSection')}>
                  {Object.entries(agentDiff.modelEnvSlotsAdded).map(([slot, val]) => (
                    <AddedRow
                      key={`model-add-${slot}`}
                      id={`${agentDiff.agent}:model_add:${slot}`}
                      selection={selection}
                      setKey={setKey}
                      label={slotLabel(slot)}
                      value={val?.name || val?.id || ''}
                    />
                  ))}
                  {agentDiff.modelEnvSlotsChanged.map((c) => (
                    <ChangedRow
                      key={`model-change-${c.slot}`}
                      id={`${agentDiff.agent}:model_change:${c.slot}`}
                      selection={selection}
                      setKey={setKey}
                      label={slotLabel(c.slot)}
                      from={c.from.name || c.from.id}
                      to={c.to.name || c.to.id}
                    />
                  ))}
                </Section>
              )}
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleApply} disabled={selectedCount === 0}>
            {t('resources.providerDialog.syncApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium text-muted-foreground">{title}</div>
      <div className="overflow-hidden rounded-md border border-border bg-card">{children}</div>
    </div>
  )
}

function RowFrame({
  id,
  selection,
  setKey,
  variant,
  children,
}: {
  id: string
  selection: Selection
  setKey: (key: string, val: boolean) => void
  variant: 'add' | 'change'
  children: React.ReactNode
}) {
  const checked = !!selection[id]
  return (
    <label className={`flex cursor-pointer items-start gap-2.5 px-3 py-2 transition-colors hover:bg-muted/50 ${variant === 'change' ? 'bg-amber-500/[0.04]' : ''}`}>
      <Checkbox checked={checked} onCheckedChange={(v) => setKey(id, !!v)} className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
    </label>
  )
}

function AddedRow({
  id,
  selection,
  setKey,
  label,
  value,
}: {
  id: string
  selection: Selection
  setKey: (key: string, val: boolean) => void
  label: string
  value: string | null
}) {
  return (
    <RowFrame id={id} selection={selection} setKey={setKey} variant="add">
      <div className="flex items-center gap-1.5 text-xs">
        <Plus className="size-3 shrink-0 text-green-700 dark:text-green-400" />
        <span className="font-mono font-medium">{label}</span>
        {value !== null && (
          <>
            <span className="text-muted-foreground">=</span>
            <span className="truncate font-mono text-muted-foreground">{value}</span>
          </>
        )}
      </div>
    </RowFrame>
  )
}

function ChangedRow({
  id,
  selection,
  setKey,
  label,
  from,
  to,
}: {
  id: string
  selection: Selection
  setKey: (key: string, val: boolean) => void
  label: string
  from: string
  to: string
}) {
  return (
    <RowFrame id={id} selection={selection} setKey={setKey} variant="change">
      <div className="space-y-0.5 text-xs">
        <div className="font-mono font-medium">{label}</div>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="truncate font-mono text-muted-foreground line-through decoration-muted-foreground/60">{from}</span>
          <ArrowRight className="size-3 shrink-0 text-amber-700 dark:text-amber-400" />
          <span className="truncate font-mono text-foreground">{to}</span>
        </div>
      </div>
    </RowFrame>
  )
}

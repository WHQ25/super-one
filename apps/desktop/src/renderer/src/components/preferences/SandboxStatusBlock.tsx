import { useTranslation } from 'react-i18next'
import type { SandboxProbeResult, SandboxSupportLevel } from '@superone/shared/agent-types'

interface SandboxStatusBlockProps {
  supportLevel: SandboxSupportLevel
  probe: SandboxProbeResult | null
  capabilityReason?: string
  onProbe: () => void
}

export function SandboxStatusBlock({ supportLevel, probe, capabilityReason, onProbe }: SandboxStatusBlockProps) {
  const { t } = useTranslation()

  if (supportLevel === 'unsupported') {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
        {capabilityReason ?? t('settings.preferences.sandbox.statusUnsupported')}
      </div>
    )
  }

  if (probe === null) {
    return (
      <div className="m-4 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <span>{t('settings.preferences.sandbox.statusNotProbed')}</span>
        <button onClick={onProbe} className="rounded border border-border bg-card px-2 py-1 text-foreground hover:bg-muted">
          {t('settings.preferences.sandbox.probeNow')}
        </button>
      </div>
    )
  }

  if (probe.ok) {
    return (
      <div className="m-4 rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-xs text-emerald-600 dark:text-emerald-400">
        {t('settings.preferences.sandbox.statusReady')}
      </div>
    )
  }

  return (
    <div className="m-4 flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-400">
      <div className="font-medium">
        {t('settings.preferences.sandbox.statusMissing', { missing: probe.missing.join(', ') })}
      </div>
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('settings.preferences.sandbox.installHintTitle')}
        </div>
        <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-card p-2 text-[11px] text-foreground">{probe.installHint}</pre>
      </div>
      <button onClick={onProbe} className="rounded border border-border bg-card px-2 py-1 text-foreground hover:bg-muted">
        {t('settings.preferences.sandbox.reProbe')}
      </button>
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import type { SandboxProbeResult, SandboxSupportLevel } from '@superone/shared/agent-types'
import { Button } from '@superone/ui/components/ui/button'
import { cn } from '@superone/ui/lib/utils'
import { settingsRowClassName } from '@/components/settings/SettingsSection'

interface SandboxStatusBlockProps {
  supportLevel: SandboxSupportLevel
  probe: SandboxProbeResult | null
  capabilityReason?: string
  onProbe: () => void
}

/** Sandbox readiness, as a row on the preferences card under the sandbox picker. */
export function SandboxStatusBlock({ supportLevel, probe, capabilityReason, onProbe }: SandboxStatusBlockProps) {
  const { t } = useTranslation()

  if (supportLevel === 'unsupported') {
    return (
      <div className={cn(settingsRowClassName, 'text-xs text-error')}>
        {capabilityReason ?? t('settings.preferences.sandbox.statusUnsupported')}
      </div>
    )
  }

  if (probe === null) {
    return (
      <div className={cn(settingsRowClassName, 'flex items-center justify-between gap-3 text-xs text-muted-foreground')}>
        <span>{t('settings.preferences.sandbox.statusNotProbed')}</span>
        <Button variant="outline" size="sm" className="h-7" onClick={onProbe}>
          {t('settings.preferences.sandbox.probeNow')}
        </Button>
      </div>
    )
  }

  if (probe.ok) {
    return (
      <div className={cn(settingsRowClassName, 'text-xs text-success')}>
        {t('settings.preferences.sandbox.statusReady')}
      </div>
    )
  }

  return (
    <div className={cn(settingsRowClassName, 'flex flex-col gap-2 text-xs')}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium text-warning">
          {t('settings.preferences.sandbox.statusMissing', { missing: probe.missing.join(', ') })}
        </span>
        <Button variant="outline" size="sm" className="h-7" onClick={onProbe}>
          {t('settings.preferences.sandbox.reProbe')}
        </Button>
      </div>
      <div>
        <div className="text-[11px] text-muted-foreground">
          {t('settings.preferences.sandbox.installHintTitle')}
        </div>
        <pre className="mt-1 max-h-32 overflow-auto rounded-md bg-background p-2 text-[11px] whitespace-pre-wrap text-foreground">{probe.installHint}</pre>
      </div>
    </div>
  )
}

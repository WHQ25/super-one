import type { ComponentProps } from 'react'
import { Loader2, Zap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import type { EndpointTestState } from './test-endpoints'

export function TestConnectionButton({
  state,
  onTest,
  disabled,
  size = 'sm',
  label,
}: {
  state: EndpointTestState
  onTest: () => void
  disabled?: boolean
  size?: ComponentProps<typeof Button>['size']
  /** Override default "Connection Test" label (e.g. per-endpoint). */
  label?: string
}) {
  const { t } = useTranslation()
  const testing = state.status === 'testing'
  return (
    <Button variant="outline" size={size} disabled={disabled || testing} onClick={onTest}>
      {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
      {testing ? t('resources.providerDialog.testing') : (label ?? t('resources.providerDialog.test'))}
    </Button>
  )
}

export function TestConnectionStatus({ state }: { state: EndpointTestState }) {
  const { t } = useTranslation()
  if (state.status === 'success') {
    const n = state.results.length
    return (
      <span className="text-[11px] text-success">
        {n > 1
          ? t('resources.providerDialog.connectedAll', { count: n })
          : t('resources.providerDialog.connected')}
      </span>
    )
  }
  if (state.status === 'error') {
    return (
      <span className="min-w-0 break-words text-[11px] text-destructive">
        {t('resources.providerDialog.connectionFailed')}{state.message ? `: ${state.message}` : ''}
      </span>
    )
  }
  return null
}

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
}: {
  state: EndpointTestState
  onTest: () => void
  disabled?: boolean
  size?: ComponentProps<typeof Button>['size']
}) {
  const { t } = useTranslation()
  const testing = state.status === 'testing'
  return (
    <Button variant="outline" size={size} disabled={disabled || testing} onClick={onTest}>
      {testing ? <Loader2 className="size-4 animate-spin" /> : <Zap className="size-4" />}
      {testing ? t('resources.providerDialog.testing') : t('resources.providerDialog.test')}
    </Button>
  )
}

export function TestConnectionStatus({ state }: { state: EndpointTestState }) {
  const { t } = useTranslation()
  if (state.status === 'success') {
    return <span className="text-[11px] text-success">{t('resources.providerDialog.connected')}</span>
  }
  if (state.status === 'error') {
    return (
      <span className="text-[11px] text-destructive">
        {t('resources.providerDialog.connectionFailed')}{state.message ? `: ${state.message}` : ''}
      </span>
    )
  }
  return null
}

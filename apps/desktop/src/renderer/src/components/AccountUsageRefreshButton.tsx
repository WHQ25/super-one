import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'

export function AccountUsageRefreshButton({ loading, disabled, onClick }: { loading?: boolean; disabled?: boolean; onClick: () => void }) {
  const { t } = useTranslation()
  return <IconButton tooltip={t('usageGauge.refreshUsage')} disabled={loading || disabled} onClick={onClick}>
    <RefreshCw className={loading ? 'animate-spin' : undefined} />
  </IconButton>
}

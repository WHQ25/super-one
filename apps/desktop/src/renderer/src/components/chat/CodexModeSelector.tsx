import { ClipboardList } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { modes } from './PermissionModeList'
import { cn } from '@superone/ui/lib/utils'
import { ComposerModeChip } from './ComposerModeChip'

const planMode = modes.find((mode) => mode.id === 'plan')!

export function CodexModeSelector() {
  const { t } = useTranslation()
  const selectedMode = useActiveSession((s) => s.selectedCodexCollaborationMode)
  const { setSelectedCodexCollaborationMode: setSelectedMode } = useScopedSessionActions()

  if (selectedMode !== 'plan') return null

  return (
    <ComposerModeChip
      icon={ClipboardList}
      label={t('chat.plan.label')}
      title={t('tooltips.exitPlanMode')}
      onExit={() => setSelectedMode('default')}
      className={cn(planMode.color, planMode.hoverBg)}
    />
  )
}

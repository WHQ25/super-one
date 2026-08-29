import { ClipboardList, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useScopedSessionActions } from '@/stores/chat'
import { modes } from './PermissionModeList'
import { cn } from '@superone/ui/lib/utils'

const planMode = modes.find((mode) => mode.id === 'plan')!

export function CodexModeSelector() {
  const { t } = useTranslation()
  const selectedMode = useActiveSession((s) => s.selectedCodexCollaborationMode)
  const { setSelectedCodexCollaborationMode: setSelectedMode } = useScopedSessionActions()

  if (selectedMode !== 'plan') return null

  return (
    <div className="group/plan-mode inline-flex items-center gap-0.5">
      <div className={cn('inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs', planMode.color)}>
        <ClipboardList className="size-3.5" />
        <span>{t('chat.plan.label')}</span>
      </div>
      <button
        onClick={() => setSelectedMode('default')}
        className={cn(
          'inline-flex items-center justify-center rounded-full size-4 opacity-0 transition-all group-hover/plan-mode:opacity-100',
          planMode.activeBg,
          planMode.color,
          planMode.hoverBg,
        )}
        title={t('tooltips.exitPlanMode')}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

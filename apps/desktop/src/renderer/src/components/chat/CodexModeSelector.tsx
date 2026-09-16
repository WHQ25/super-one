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
    <button
      type="button"
      onClick={() => setSelectedMode('default')}
      title={t('tooltips.exitPlanMode')}
      className={cn(
        'group/plan-mode inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs transition-colors',
        planMode.color,
        planMode.hoverBg,
      )}
    >
      {/* Leading icon becomes the close affordance on hover, the way the
          sidebar rows do it — the chip only gains a background, never a
          different text colour. */}
      <ClipboardList className="size-3.5 shrink-0 group-hover/plan-mode:hidden" />
      <X className="hidden size-3.5 shrink-0 group-hover/plan-mode:block" />
      <span>{t('chat.plan.label')}</span>
    </button>
  )
}

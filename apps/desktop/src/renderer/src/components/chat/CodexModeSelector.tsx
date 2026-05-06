import { ClipboardList, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useActiveSession, useChatStore } from '@/stores/chat'

export function CodexModeSelector() {
  const { t } = useTranslation()
  const selectedMode = useActiveSession((s) => s.selectedCodexCollaborationMode)
  const setSelectedMode = useChatStore((s) => s.setSelectedCodexCollaborationMode)

  if (selectedMode !== 'plan') return null

  return (
    <div className="group/plan-mode inline-flex items-center gap-0.5">
      <div className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] text-blue-600 dark:text-blue-400">
        <ClipboardList className="size-3.5" />
        <span>{t('chat.plan.label')}</span>
      </div>
      <button
        onClick={() => setSelectedMode('default')}
        className="inline-flex items-center justify-center rounded-full size-4 bg-blue-500/15 text-blue-600 dark:text-blue-400 opacity-0 transition-all hover:bg-blue-500/25 hover:text-blue-700 dark:hover:text-blue-300 group-hover/plan-mode:opacity-100"
        title={t('tooltips.exitPlanMode')}
      >
        <X className="size-3" />
      </button>
    </div>
  )
}

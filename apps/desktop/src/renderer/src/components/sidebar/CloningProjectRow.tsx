import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

interface CloningProjectRowProps {
  name: string
  progress: number | null
}

export function CloningProjectRow({ name, progress }: CloningProjectRowProps) {
  const { t } = useTranslation()
  return (
    <div
      data-slot="cloning-project-row"
      aria-disabled="true"
      className="flex h-9 cursor-default items-center overflow-hidden rounded-md pl-2.5 pr-2 opacity-60 select-none"
    >
      <span className="flex size-4 shrink-0 items-center justify-center">
        <Loader2
          aria-label={t('sidebar.addProject.cloning')}
          className="size-3.5 animate-spin text-sidebar-foreground/70"
        />
      </span>
      <span className="ml-2 min-w-0 truncate text-md">{name}</span>
      {progress !== null && (
        <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-sidebar-foreground/70">
          {progress}%
        </span>
      )}
    </div>
  )
}

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { SidebarGroupBy } from '@/lib/multi-host/types'

/** Projects label stays. This menu picks project versus environment. */
export function SidebarGroupMenu({
  value,
  onChange,
  open,
}: {
  value: SidebarGroupBy
  onChange: (value: SidebarGroupBy) => void
  /** Stories pin the menu open. */
  open?: boolean
}) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const current = value === 'environment' ? t('sidebar.groupBy.environment') : t('sidebar.groupBy.project')
  return (
    <DropdownMenu open={open ?? uncontrolledOpen} onOpenChange={open === undefined ? setUncontrolledOpen : undefined}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t('sidebar.groupBy.label')}
          className="flex min-w-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs text-sidebar-foreground/70 hover:bg-sidebar-hover"
        >
          <span className="truncate">{current}</span>
          <ChevronDown className="size-3 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-40">
        <DropdownMenuLabel className="text-xs">{t('sidebar.groupBy.label')}</DropdownMenuLabel>
        <DropdownMenuItem onClick={() => onChange('project')} className="text-xs">
          {value === 'project' ? '✓ ' : '   '}{t('sidebar.groupBy.project')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onChange('environment')} className="text-xs">
          {value === 'environment' ? '✓ ' : '   '}{t('sidebar.groupBy.environment')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

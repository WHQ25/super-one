import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import type { WorkDirEnvironmentOption } from './work-dir-environment'

export interface WorkDirEnvironmentMenuProps {
  /** Hidden until another machine is connected. */
  visible: boolean
  loading?: boolean
  error?: string | null
  /** A started session can show its environment and cannot switch it. */
  readOnly?: boolean
  options: WorkDirEnvironmentOption[]
  selectedId: string
  /** Stories pin the menu open. */
  open?: boolean
  onSelect: (option: WorkDirEnvironmentOption) => void
  onClone: (option: WorkDirEnvironmentOption) => void
}

export function WorkDirEnvironmentMenu({
  visible,
  loading = false,
  error = null,
  readOnly = false,
  options,
  selectedId,
  open,
  onSelect,
  onClone,
}: WorkDirEnvironmentMenuProps) {
  const { t } = useTranslation()
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  if (!visible) return null
  if (!loading && options.length < 2) return null

  const current = options.find((option) => option.environmentId === selectedId || option.connectionId === selectedId)
    ?? options.find((option) => option.kind === 'current')
  const label = current?.label ?? t('chat.worktree.environment')

  if (readOnly) {
    return (
      <div className="border-b px-3 py-2 text-xs">
        <div className="text-muted-foreground">{t('chat.worktree.environment')}</div>
        <div className="truncate">{label}</div>
        <p className="text-muted-foreground">{t('chat.worktree.environmentFixed', { environment: label })}</p>
      </div>
    )
  }

  return (
    <div className="border-b px-3 py-2">
      <DropdownMenu open={open ?? uncontrolledOpen} onOpenChange={open === undefined ? setUncontrolledOpen : undefined}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex w-full min-w-0 items-center gap-2 text-left text-xs">
            <span className="shrink-0 text-muted-foreground">{t('chat.worktree.environment')}</span>
            <span className="min-w-0 flex-1 truncate">{loading ? t('common.loading') : label}</span>
            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 max-w-[var(--radix-dropdown-menu-trigger-width)]">
          {options.map((option) => {
            const disabled = option.kind === 'offline' || option.kind === 'not-a-git-repo'
            const detail = option.kind === 'offline'
              ? t('chat.worktree.offline')
              : option.kind === 'not-a-git-repo'
                ? t('chat.worktree.notAGitRepo')
                : option.kind === 'clone-here'
                  ? t('chat.worktree.cloneHere')
                  : null
            return (
              <DropdownMenuItem
                key={option.environmentId}
                disabled={disabled || option.kind === 'current'}
                onSelect={() => {
                  if (option.kind === 'clone-here') onClone(option)
                  else if (!disabled && option.kind !== 'current') onSelect(option)
                }}
                className="gap-2 text-xs"
              >
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {detail && <span className="shrink-0 text-muted-foreground">{detail}</span>}
                {option.needsUpgrade && option.kind !== 'offline' && (
                  <span className="shrink-0 text-muted-foreground">{t('chat.worktree.needsUpgrade')}</span>
                )}
                {option.kind === 'current' && <Check className="size-3 shrink-0 text-primary" />}
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && <p className="pt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

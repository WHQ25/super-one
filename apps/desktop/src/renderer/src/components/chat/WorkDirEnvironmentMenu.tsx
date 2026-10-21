import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@superone/ui/components/ui/dropdown-menu'
import { EnvironmentKindIcon } from '@/components/sidebar/multi-host/EnvironmentSectionHeader'
import type { EnvironmentKind } from '@/lib/multi-host/types'
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
  const kindText = (kind: EnvironmentKind | undefined) => {
    if (kind === 'cli-node') return t('sidebar.hover.kindCliNode')
    if (kind === 'remote-desktop') return t('sidebar.hover.kindRemoteDesktop')
    return t('sidebar.hover.kindLocal')
  }
  if (!visible) return null
  if (!loading && options.length === 0) return null

  const current = options.find((option) => option.environmentId === selectedId || option.connectionId === selectedId)
    ?? options.find((option) => option.kind === 'current')
  const label = current?.label ?? t('chat.worktree.environment')

  const currentKind = kindText(current?.hostKind)

  if (readOnly) {
    return (
      <div className="border-b px-3 py-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <EnvironmentKindIcon kind={current?.hostKind ?? 'local'} className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="shrink-0 text-muted-foreground">{currentKind}</span>
        </div>
      </div>
    )
  }

  return (
    <div className="border-b px-3 py-2">
      <DropdownMenu open={open ?? uncontrolledOpen} onOpenChange={open === undefined ? setUncontrolledOpen : undefined}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex w-full min-w-0 items-center gap-2 text-left text-xs">
            <span className="shrink-0 text-muted-foreground">{t('chat.worktree.environment')}</span>
            <EnvironmentKindIcon kind={current?.hostKind ?? 'local'} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{loading ? t('common.loading') : label}</span>
            {!loading && <span className="shrink-0 text-muted-foreground">{currentKind}</span>}
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
                <EnvironmentKindIcon kind={option.hostKind ?? 'local'} className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                <span className="shrink-0 text-muted-foreground">{kindText(option.hostKind)}</span>
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

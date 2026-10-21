import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronRight } from 'lucide-react'
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
  /** Stories pin the device submenu open. */
  picking?: boolean
  onSelect: (option: WorkDirEnvironmentOption) => void
  onClone: (option: WorkDirEnvironmentOption) => void
}

function kindLabel(kind: EnvironmentKind | undefined, t: (key: string) => string) {
  if (kind === 'cli-node') return t('sidebar.hover.kindCliNode')
  if (kind === 'remote-desktop') return t('sidebar.hover.kindRemoteDesktop')
  return t('sidebar.hover.kindLocal')
}

export function WorkDirEnvironmentMenu({
  visible,
  loading = false,
  error = null,
  readOnly = false,
  options,
  selectedId,
  picking,
  onSelect,
  onClone,
}: WorkDirEnvironmentMenuProps) {
  const { t } = useTranslation()
  const [hoverOpen, setHoverOpen] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (!visible) return null
  if (!loading && options.length === 0) return null

  const current = options.find((option) => option.environmentId === selectedId || option.connectionId === selectedId)
    ?? options.find((option) => option.kind === 'current')
  const label = current?.label ?? ''
  const currentKind = kindLabel(current?.hostKind, t)
  const open = picking ?? hoverOpen
  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    setHoverOpen(true)
  }
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => setHoverOpen(false), 150)
  }
  const header = (
    <>
      <EnvironmentKindIcon kind={current?.hostKind ?? 'local'} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{loading ? t('common.loading') : label}</span>
      {!loading && <span className="shrink-0 text-muted-foreground">{currentKind}</span>}
    </>
  )

  return (
    <div className="border-b">
      {readOnly ? (
        <div className="flex min-w-0 items-center gap-2 px-3 py-2 text-xs">{header}</div>
      ) : (
        <DropdownMenu open={open} onOpenChange={picking === undefined ? setHoverOpen : undefined} modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
              onMouseEnter={show}
              onMouseLeave={hide}
            >
              {header}
              <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="w-72"
            onMouseEnter={show}
            onMouseLeave={hide}
          >
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
                  disabled={disabled}
                  onSelect={() => {
                    if (option.kind === 'current') return
                    if (option.kind === 'clone-here') onClone(option)
                    else if (!disabled) onSelect(option)
                  }}
                  className="gap-2 text-xs"
                >
                  <EnvironmentKindIcon kind={option.hostKind ?? 'local'} className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  <span className="shrink-0 text-muted-foreground">{kindLabel(option.hostKind, t)}</span>
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
      )}
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

import { useTranslation } from 'react-i18next'
import { Check, ChevronDown } from 'lucide-react'
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
  /** The list replaces the popover body instead of opening another panel. */
  picking?: boolean
  onPickingChange?: (picking: boolean) => void
  onSelect: (option: WorkDirEnvironmentOption) => void
  onClone: (option: WorkDirEnvironmentOption) => void
}

function kindText(kind: EnvironmentKind | undefined, t: (key: string) => string) {
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
  picking = false,
  onPickingChange,
  onSelect,
  onClone,
}: WorkDirEnvironmentMenuProps) {
  const { t } = useTranslation()
  if (!visible) return null
  if (!loading && options.length === 0) return null

  const current = options.find((option) => option.environmentId === selectedId || option.connectionId === selectedId)
    ?? options.find((option) => option.kind === 'current')
  const label = current?.label ?? ''
  const currentKind = kindText(current?.hostKind, t)
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
        <button
          type="button"
          className="flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
          onClick={() => onPickingChange?.(!picking)}
        >
          {header}
          <ChevronDown className={`size-3 shrink-0 text-muted-foreground transition-transform duration-200 ${picking ? 'rotate-180' : ''}`} />
        </button>
      )}
      {error && <p className="px-3 pb-2 text-xs text-destructive">{error}</p>}
    </div>
  )
}

export function WorkDirEnvironmentList({
  options,
  onSelect,
  onClone,
  onBack,
}: {
  options: WorkDirEnvironmentOption[]
  onSelect: (option: WorkDirEnvironmentOption) => void
  onClone: (option: WorkDirEnvironmentOption) => void
  onBack?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="max-h-80 overflow-y-auto py-1">
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
          <button
            key={option.environmentId}
            type="button"
            disabled={disabled}
            onClick={() => {
              if (option.kind === 'current') { onBack?.(); return }
              if (option.kind === 'clone-here') onClone(option)
              else if (!disabled) onSelect(option)
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          >
            <EnvironmentKindIcon kind={option.hostKind ?? 'local'} className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{option.label}</span>
            <span className="shrink-0 text-muted-foreground">{kindText(option.hostKind, t)}</span>
            {detail && <span className="shrink-0 text-muted-foreground">{detail}</span>}
            {option.needsUpgrade && option.kind !== 'offline' && (
              <span className="shrink-0 text-muted-foreground">{t('chat.worktree.needsUpgrade')}</span>
            )}
            {option.kind === 'current' && <Check className="size-3 shrink-0 text-primary" />}
          </button>
        )
      })}
    </div>
  )
}

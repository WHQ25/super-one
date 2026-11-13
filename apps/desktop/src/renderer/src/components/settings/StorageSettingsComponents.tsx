import { useTranslation } from 'react-i18next'
import { FolderOpen, Loader2, Trash2, Wand } from 'lucide-react'
import { Button } from '@superone/ui/components/ui/button'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Skeleton } from '@superone/ui/components/ui/skeleton'
import { cn } from '@superone/ui/lib/utils'
import { formatBytes } from '@superone/shared/format-bytes'
import type {
  StorageAction,
  StorageApplyAction,
  StorageCategory,
  StorageCategoryId,
  StorageInventory,
} from '@superone/shared/desktop-storage'
import { SettingsRow } from './SettingsSection'
import {
  optimizePlan,
  reclaimableBytes,
  rowOptimizableBytes,
  SECTION_BAR_CLASS,
  SECTION_STRIPE_COLOR,
  sectionBytes,
  sectionOf,
  storageTotalBytes,
} from './storage-optimize'

const COPY: Record<StorageCategoryId, string> = {
  'chat-database': 'chatDatabase',
  backup: 'backup',
  'recovery-leftovers': 'recoveryLeftovers',
  'browser-http-cache': 'browserHttpCache',
  'browser-code-cache': 'browserCodeCache',
  'browser-site-data': 'browserSiteData',
  'node-event-log': 'nodeEventLog',
  'sync-attachments': 'syncAttachments',
  'sync-media': 'syncMedia',
  'app-cache': 'appCache',
  'cursor-sdk': 'cursorSdk',
  'harness-runtimes': 'harnessRuntimes',
  logs: 'logs',
}

const WIDTH_TRANSITION = 'transition-[width] duration-500 ease-out'

export function isApplyAction(action: StorageAction): action is StorageApplyAction {
  return action !== 'reveal'
}

export function StorageSummary({ inventory, optimizing, locked, onOptimize }: {
  inventory: StorageInventory
  optimizing: boolean
  locked: boolean
  onOptimize: () => void
}) {
  const { t } = useTranslation()
  const total = storageTotalBytes(inventory)
  const sections = sectionBytes(inventory)
  const reclaimable = reclaimableBytes(inventory)
  const canOptimize = optimizePlan(inventory).length > 0

  return (
    <div className="rounded-lg bg-muted/50 px-4 py-4" data-testid="storage-summary">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap gap-x-8 gap-y-2">
          <div>
            <p className="text-xs text-muted-foreground">{t('storageSettings.occupiedSpace')}</p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatBytes(total)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">{t('storageSettings.optimizableSpace')}</p>
            <p className="text-3xl font-semibold tabular-nums tracking-tight">{formatBytes(reclaimable)}</p>
          </div>
        </div>
        <Button type="button" data-testid="storage-optimize" disabled={!canOptimize || locked} onClick={onOptimize}>
          {optimizing ? <Loader2 className="size-4 animate-spin" /> : <Wand className="size-4" />}
          {optimizing ? t('storageSettings.optimizing') : t('storageSettings.optimize')}
        </Button>
      </div>
      <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-background" aria-hidden>
        {total > 0 && sections.filter((section) => section.bytes > 0).map((section) => (
          <div
            key={section.id}
            className={cn('h-full min-w-0 shrink-0', WIDTH_TRANSITION, SECTION_BAR_CLASS[section.id])}
            style={{ width: `${(section.bytes / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
        {sections.map((section) => (
          <li key={section.id} className="flex min-w-0 items-center gap-2 text-xs">
            <span className={cn('size-2 shrink-0 rounded-full', SECTION_BAR_CLASS[section.id])} aria-hidden />
            <span className="min-w-0 truncate">{t(`storageSettings.sections.${section.id}`)}</span>
            <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{formatBytes(section.bytes)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function CategoryRow({ category, inventory, share, busy, locked, onReveal, onAction, label, description, testId }: {
  category: StorageCategory
  inventory: StorageInventory
  share: number
  busy: StorageApplyAction | null
  locked: boolean
  onReveal: (path: string) => void
  onAction: (action: StorageApplyAction) => void
  label?: string
  description?: string
  testId?: string
}) {
  const { t } = useTranslation()
  const copy = COPY[category.id]
  const actions = [...category.actions.filter((action) => action === 'reveal'), ...category.actions.filter((action) => action !== 'reveal')]
  const barClass = SECTION_BAR_CLASS[sectionOf(category.id)]
  const stripe = SECTION_STRIPE_COLOR[sectionOf(category.id)]
  const optimizable = rowOptimizableBytes(category)
  const optimizableRatio = category.bytes > 0 ? Math.min(1, optimizable / category.bytes) : 0
  return (
    <SettingsRow
      label={label ?? t(`storageSettings.categories.${copy}.label`)}
      description={(
        <span>
          {description ?? t(`storageSettings.categories.${copy}.description`)}
          {category.id === 'node-event-log' && inventory.nodeEvents && (
            <>
              {' '}
              {t('storageSettings.eventRows', { count: inventory.nodeEvents.rows })}
              {inventory.nodeEvents.lastCompactAt !== null && (
                <>
                  {' '}
                  {t('storageSettings.lastCompact', {
                    when: new Date(inventory.nodeEvents.lastCompactAt).toLocaleString(),
                    bytes: formatBytes(inventory.nodeEvents.lastFreedBytes ?? 0),
                  })}
                </>
              )}
            </>
          )}
        </span>
      )}
      footer={(
        <div className="space-y-1.5">
          <SpacePair optimizable={optimizable} occupied={category.bytes} />
          <div className="h-2 overflow-hidden rounded-full bg-background/80" aria-hidden data-storage-track="">
            <div className={cn('flex h-full min-w-0 shrink-0', WIDTH_TRANSITION)} style={{ width: barWidth(share) }}>
              {optimizableRatio < 1 && (
                <div className={cn('h-full min-w-0 shrink-0', WIDTH_TRANSITION, barClass)} style={{ width: `${(1 - optimizableRatio) * 100}%` }} />
              )}
              {optimizableRatio > 0 && (
                <div
                  className={cn('h-full min-w-0 shrink-0', WIDTH_TRANSITION)}
                  style={{
                    width: `${optimizableRatio * 100}%`,
                    backgroundImage: `repeating-linear-gradient(-45deg, transparent 0 3px, ${stripe} 3px 4.5px)`,
                  }}
                  data-storage-part="optimizable"
                  data-storage-fill="hatch"
                />
              )}
            </div>
          </div>
        </div>
      )}
      data-testid={testId ?? `storage-${category.id}`}
    >
      {actions.map((action) => {
        const running = isApplyAction(action) && busy === action
        const disabled = actionDisabled(category, inventory, action) || (isApplyAction(action) && locked)
        const name = t(actionLabel(action, running))
        if (action === 'reveal') {
          return (
            <IconButton key={action} size="md" tooltip={name} disabled={disabled} onClick={() => { if (category.path) onReveal(category.path) }}>
              <FolderOpen />
            </IconButton>
          )
        }
        if (isRemoveAction(action)) {
          return (
            <IconButton key={action} size="md" variant="destructive" tooltip={name} disabled={disabled} onClick={() => onAction(action)}>
              {running ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </IconButton>
          )
        }
        return (
          <Button
            key={action}
            type="button"
            variant="outline"
            size="sm"
            className="h-7"
            disabled={disabled}
            onClick={() => onAction(action)}
          >
            {running && <Loader2 className="size-3.5 animate-spin" />}
            {name}
          </Button>
        )
      })}
    </SettingsRow>
  )
}

export function SpacePair({ optimizable, occupied, testId }: { optimizable: number; occupied: number; testId?: string }) {
  const { t } = useTranslation()
  return (
    <p className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 text-xs tabular-nums" data-testid={testId}>
      <span>
        <span className="text-muted-foreground">{t('storageSettings.occupiedSpace')}</span>
        {' '}
        {formatBytes(occupied)}
      </span>
      <span>
        <span className="text-muted-foreground">{t('storageSettings.optimizableSpace')}</span>
        {' '}
        {formatBytes(optimizable)}
      </span>
    </p>
  )
}

export function StorageLoading({ label }: { label: string }) {
  return (
    <div data-testid="storage-loading" aria-busy="true" aria-label={label} className="space-y-5">
      <div className="rounded-lg bg-muted/50 px-4 py-4">
        <div className="flex items-center justify-between gap-6">
          <div className="flex gap-8">
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-8 w-28" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
          <Skeleton className="h-9 w-28" />
        </div>
        <Skeleton className="mt-4 h-3 w-full rounded-full" />
        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-3 w-32" />)}
        </div>
      </div>
      {Array.from({ length: 3 }, (_, section) => (
        <div key={section}>
          <div className="mb-1.5 ml-1 flex items-center justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-36" />
          </div>
          <div className="rounded-lg bg-muted/50">
            {Array.from({ length: 2 }, (_, row) => (
              <div key={row} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-56 max-w-full" />
                  </div>
                  <Skeleton className="size-7" />
                </div>
                <Skeleton className="h-2 w-full rounded-full" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function barWidth(share: number): string {
  return `${Math.min(100, Math.max(0, share) * 100)}%`
}

function isRemoveAction(action: StorageAction): boolean {
  return isDeleteAction(action) || isClearAction(action)
}

function isDeleteAction(action: StorageAction): boolean {
  return action === 'delete-backups' || action === 'delete-leftovers'
}

function isClearAction(action: StorageAction): boolean {
  return action === 'clear-browser-http-cache'
    || action === 'clear-browser-code-cache'
    || action === 'clear-browser-site-data'
    || action === 'clear-sync-attachments'
    || action === 'clear-sync-media'
    || action === 'clear-app-cache'
    || action === 'clear-logs'
    || action === 'clear-unused-harness-runtimes'
}

function actionDisabled(category: StorageCategory, inventory: StorageInventory, action: StorageAction): boolean {
  if (action === 'reveal') return !category.path
  if (action === 'clear-unused-harness-runtimes') return (category.unusedBytes ?? 0) === 0
  if (action === 'clear-app-cache') return (category.unusedBytes ?? category.bytes) === 0
  if (action === 'compact-node-events') return category.bytes === 0 && (inventory.nodeEvents?.rows ?? 0) === 0
  return category.bytes === 0
}

function actionLabel(action: StorageAction, running: boolean): string {
  if (action === 'reveal') return 'storageSettings.reveal'
  if (action === 'compact-node-events') return running ? 'storageSettings.compacting' : 'storageSettings.compact'
  if (action === 'clear-unused-harness-runtimes') return 'storageSettings.clearUnused'
  if (isDeleteAction(action)) return 'common.delete'
  return 'storageSettings.clear'
}

import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { formatBytes } from '@superone/shared/format-bytes'
import {
  isRetiredHarness,
  type StorageApplyAction,
  type StorageCategory,
  type StorageCategoryId,
  type StorageCompactResult,
  type StorageHarnessRuntime,
  type StorageInventory,
} from '@superone/shared/desktop-storage'
import { isConcreteHarnessId } from '@superone/shared/harness/acp-brand'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { SettingsPage, SettingsSection } from './SettingsSection'
import {
  optimizePlan,
  sectionBytes,
  sectionDisplayedOptimizable,
  STORAGE_SECTIONS,
  storageTotalBytes,
} from './storage-optimize'
import { CategoryRow, SpacePair, StorageLoading, StorageSummary } from './StorageSettingsComponents'

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; inventory: StorageInventory }

const CONFIRM: Partial<Record<StorageApplyAction, string>> = {
  'delete-backups': 'deleteBackups',
  'delete-leftovers': 'deleteLeftovers',
  'clear-browser-site-data': 'clearSiteData',
  'clear-sync-attachments': 'clearSyncAttachments',
  'clear-sync-media': 'clearSyncMedia',
  'clear-unused-harness-runtimes': 'clearUnusedHarness',
  'clear-logs': 'clearLogs',
}

function confirmKey(action: StorageApplyAction, harnessId: string | null): string | undefined {
  if (action === 'clear-unused-harness-runtimes' && harnessId && isRetiredHarness(harnessId)) {
    return 'clearRetiredAntigravity'
  }
  return CONFIRM[action]
}

export function StorageSettingsPage() {
  const { t } = useTranslation()
  const [state, setState] = useState<State>({ status: 'loading' })
  const [pending, setPending] = useState<StorageApplyAction | null>(null)
  const [pendingHarnessId, setPendingHarnessId] = useState<string | null>(null)
  const [busy, setBusy] = useState<StorageApplyAction | null>(null)
  const [optimizing, setOptimizing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const inventory = await window.app.getStorageInventory()
      setState({ status: 'ready', inventory })
    } catch {
      setState({ status: 'error' })
    }
  }, [])

  useEffect(() => {
    let live = true
    void window.app.getStorageInventory().then(
      (inventory) => { if (live) setState({ status: 'ready', inventory }) },
      () => { if (live) setState({ status: 'error' }) },
    )
    return () => { live = false }
  }, [])

  async function run(action: StorageApplyAction, harnessId?: string) {
    setPending(null)
    setPendingHarnessId(null)
    setBusy(action)
    setNotice(null)
    try {
      const result = harnessId
        ? await window.app.applyStorageAction(action, harnessId)
        : await window.app.applyStorageAction(action)
      if (result.compact) {
        const key = result.compact.vacuum === 'skipped' ? 'storageSettings.vacuumSkipped' : 'storageSettings.compactResult'
        setNotice(t(key, { rows: result.compact.removedRows, bytes: formatBytes(result.compact.freedBytes) }))
      }
      await load()
    } catch {
      setState({ status: 'error' })
    } finally {
      setBusy(null)
    }
  }

  async function runOptimize(inventory: StorageInventory) {
    const plan = optimizePlan(inventory)
    if (plan.length === 0 || busy || optimizing) return
    setNotice(null)
    setOptimizing(true)
    let freed = 0
    let compact: StorageCompactResult | undefined
    try {
      for (const action of plan) {
        setBusy(action)
        const result = await window.app.applyStorageAction(action)
        if (action === 'compact-node-events' && result.compact) compact = result.compact
        else freed += result.removedBytes
        const next = await window.app.getStorageInventory()
        setState({ status: 'ready', inventory: next })
      }
      setNotice(optimizeNotice(t, freed, compact))
    } catch (error) {
      console.error('[storage] optimize failed', error)
      setNotice(t('storageSettings.optimizeFailed'))
      try {
        const next = await window.app.getStorageInventory()
        setState({ status: 'ready', inventory: next })
      } catch {
        setState({ status: 'error' })
      }
    } finally {
      setBusy(null)
      setOptimizing(false)
    }
  }

  function ask(action: StorageApplyAction, harnessId?: string) {
    if (busy || optimizing) return
    if (CONFIRM[action]) {
      setPendingHarnessId(harnessId ?? null)
      setPending(action)
    } else void run(action, harnessId)
  }

  const inventory = state.status === 'ready' ? state.inventory : null
  const locked = busy !== null || optimizing

  return (
    <SettingsPage title={t('storageSettings.title')} description={t('storageSettings.description')}>
      {state.status === 'loading' && <StorageLoading label={t('common.loading')} />}
      {state.status === 'error' && (
        <div className="flex items-center justify-between gap-3" data-testid="storage-error">
          <p className="text-sm text-destructive">{t('storageSettings.unreadable')}</p>
          <Button type="button" variant="outline" size="sm" className="h-7" onClick={() => { setState({ status: 'loading' }); void load() }}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {notice && <p className="text-sm text-muted-foreground" data-testid="storage-notice">{notice}</p>}
      {inventory && (
        <StorageSummary
          inventory={inventory}
          optimizing={optimizing}
          locked={locked}
          onOptimize={() => { void runOptimize(inventory) }}
        />
      )}
      {inventory && STORAGE_SECTIONS.map((section) => {
        const harnessRows = section.id === 'runtimes' ? runtimeRows(inventory) : []
        const rows = section.ids.flatMap((id) => inventory.categories.filter((category) => category.id === id))
          .filter((category) => !hiddenRuntimeCategory(category.id, harnessRows))
        if (rows.length === 0 && harnessRows.length === 0) return null
        const total = storageTotalBytes(inventory)
        const occupied = sectionBytes(inventory).find((item) => item.id === section.id)?.bytes ?? 0
        return (
          <SettingsSection
            key={section.id}
            title={t(`storageSettings.sections.${section.id}`)}
            actions={(
              <SpacePair
                testId={`storage-section-${section.id}`}
                optimizable={sectionDisplayedOptimizable(inventory, section.id)}
                occupied={occupied}
              />
            )}
          >
            {rows.map((category) => (
              <CategoryRow
                key={category.id}
                category={category}
                inventory={inventory}
                share={total > 0 ? category.bytes / total : 0}
                busy={busy}
                locked={locked}
                onReveal={(path) => { void window.app.revealFile(path) }}
                onAction={ask}
              />
            ))}
            {harnessRows.map((runtime) => (
              <CategoryRow
                key={runtime.id}
                category={runtimeCategory(runtime)}
                inventory={inventory}
                share={total > 0 ? runtime.bytes / total : 0}
                busy={busy}
                locked={locked}
                label={harnessTitle(runtime.id)}
                description={isRetiredHarness(runtime.id) ? t('storageSettings.retiredAntigravity') : undefined}
                testId={`storage-harness-${runtime.id}`}
                onReveal={(path) => { void window.app.revealFile(path) }}
                onAction={(action) => ask(action, runtime.id)}
              />
            ))}
          </SettingsSection>
        )
      })}

      <Dialog open={pending !== null} onOpenChange={(open) => { if (!open) { setPending(null); setPendingHarnessId(null) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('storageSettings.confirmTitle')}</DialogTitle>
            <DialogDescription>
              {pending && confirmKey(pending, pendingHarnessId) ? t(`storageSettings.confirms.${confirmKey(pending, pendingHarnessId)}`) : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPending(null)}>{t('common.cancel')}</Button>
            <Button type="button" variant="destructive" data-testid="storage-confirm" onClick={() => pending && void run(pending, pendingHarnessId ?? undefined)}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPage>
  )
}

function runtimeRows(inventory: StorageInventory): StorageHarnessRuntime[] {
  return (inventory.harnessRuntimes ?? [])
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
}

function hiddenRuntimeCategory(id: StorageCategoryId, rows: StorageHarnessRuntime[]): boolean {
  return id === 'harness-runtimes' && rows.length > 0
}

function runtimeCategory(runtime: StorageHarnessRuntime): StorageCategory {
  return {
    id: 'harness-runtimes',
    bytes: runtime.bytes,
    unusedBytes: runtime.unusedBytes,
    path: runtime.path,
    actions: ['reveal', 'clear-unused-harness-runtimes'],
  }
}

function harnessTitle(id: string): string {
  return isConcreteHarnessId(id) ? HARNESS_CAPABILITIES[id].displayName : id
}

function optimizeNotice(
  t: (key: string, values?: Record<string, unknown>) => string,
  freed: number,
  compact: StorageCompactResult | undefined,
): string {
  if (!compact) return t('storageSettings.optimizeFreed', { bytes: formatBytes(freed) })
  const key = compact.vacuum === 'skipped' ? 'storageSettings.optimizeVacuumSkipped' : 'storageSettings.optimizeResult'
  return t(key, {
    bytes: formatBytes(freed),
    rows: compact.removedRows,
    eventBytes: formatBytes(compact.freedBytes),
  })
}

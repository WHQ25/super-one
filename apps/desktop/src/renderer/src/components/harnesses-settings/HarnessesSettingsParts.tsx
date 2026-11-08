import { formatBytes } from '@superone/shared/format-bytes'
import type { CSSProperties, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { GripVertical, Loader2, RefreshCw } from 'lucide-react'
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Button } from '@superone/ui/components/ui/button'
import { Badge } from '@superone/ui/components/ui/badge'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentDisplayName, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import type { HarnessId } from '@superone/shared/session-types'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { SettingsNavGroup, SettingsNavItem } from '../settings/SettingsNav'
import { SettingsCard, SettingsRow, settingsRowClassName } from '../settings/SettingsSection'

export interface CatalogRow {
  id: string
  enabled: boolean
  state: string
  runtimeSource: string
  requiresAuth: boolean
  runtimeVersion?: string
  command?: string
  diagnostic?: { code: string; message: string }
}

export type ListItem =
  | {
      key: string
      kind: 'catalog'
      catalogId: NodeHarnessId
      label: string
      provider: HarnessId
      acpAgentId: string | null
      experimental: boolean
      description: string
      configProvider?: SettingsProvider
    }
  | {
      key: string
      kind: 'experimental-acp'
      acpAgentId: string
      label: string
      provider: 'acp'
      experimental: true
      description: string
      configProvider?: undefined
    }

export interface ProgressState {
  received: number
  total: number
  phase: 'download' | 'done' | 'error'
  message?: string
}

interface CatalogHarnessMeta {
  provider: HarnessId
  labelKey: string
  descriptionKey: string
  experimental: boolean
  configProvider?: SettingsProvider
}

export const CATALOG_HARNESS_META = {
  claude: {
    provider: 'claude',
    labelKey: 'settings.harnesses.ids.claude',
    descriptionKey: 'settings.harnesses.desc.claude',
    experimental: false,
    configProvider: 'claude',
  },
  codex: {
    provider: 'codex',
    labelKey: 'settings.harnesses.ids.codex',
    descriptionKey: 'settings.harnesses.desc.codex',
    experimental: false,
    configProvider: 'codex',
  },
  opencode: {
    provider: 'opencode',
    labelKey: 'settings.harnesses.ids.opencode',
    descriptionKey: 'settings.harnesses.desc.opencode',
    experimental: true,
    configProvider: 'opencode',
  },
  cursor: {
    provider: 'cursor',
    labelKey: 'settings.harnesses.ids.cursor',
    descriptionKey: 'settings.harnesses.desc.cursor',
    experimental: true,
    configProvider: 'cursor',
  },
  'acp-grok': {
    provider: 'acp',
    labelKey: 'settings.harnesses.ids.acp-grok',
    descriptionKey: 'settings.harnesses.desc.acpGrok',
    experimental: false,
    configProvider: 'acp',
  },
  'acp-antigravity': {
    provider: 'acp',
    labelKey: 'settings.harnesses.ids.acp-antigravity',
    descriptionKey: 'settings.harnesses.desc.acpAntigravity',
    experimental: true,
    configProvider: 'acp',
  },
  dsh: {
    provider: 'dsh',
    labelKey: 'settings.harnesses.ids.deepseek',
    descriptionKey: 'settings.harnesses.desc.deepseek',
    experimental: true,
    configProvider: 'dsh',
  },
} satisfies Record<NodeHarnessId, CatalogHarnessMeta>

export function catalogIsOn(row: CatalogRow | undefined): boolean {
  if (!row) return false
  return row.enabled && row.state !== 'disabled'
}

export function buildHarnessListItems(
  acpAgents: AcpAgentDescriptor[],
  nonOpenCodeAgents: AcpAgentDescriptor[],
  t: (key: string) => string,
): ListItem[] {
  const grok = nonOpenCodeAgents.find((a) => isGrokAcpAgent(a.id))
  const antigravity = nonOpenCodeAgents.find((a) => isAntigravityAcpAgent(a.id))
  const rest = nonOpenCodeAgents.filter((a) => !isGrokAcpAgent(a.id) && !isAntigravityAcpAgent(a.id))
  const list: ListItem[] = NODE_HARNESS_IDS.map((catalogId) => {
    const meta: CatalogHarnessMeta = CATALOG_HARNESS_META[catalogId]
    return {
      key: catalogId,
      kind: 'catalog',
      catalogId,
      label:
        catalogId === 'acp-grok'
          ? (grok?.name || t(meta.labelKey))
          : catalogId === 'acp-antigravity'
            ? (antigravity?.name || t(meta.labelKey))
            : t(meta.labelKey),
      provider: meta.provider,
      acpAgentId:
        catalogId === 'acp-grok'
          ? (grok?.id ?? 'grok-build')
          : catalogId === 'acp-antigravity'
            ? (antigravity?.id ?? 'antigravity')
            : null,
      experimental: meta.experimental,
      description: t(meta.descriptionKey),
      configProvider: meta.configProvider,
    }
  })

  for (const agent of rest) {
    list.push({
      key: `acp:${agent.id}`,
      kind: 'experimental-acp',
      acpAgentId: agent.id,
      label: agent.name || acpAgentDisplayName(agent.id),
      provider: 'acp',
      experimental: true,
      description: t('settings.harnesses.desc.experimentalAcp'),
    })
  }
  void acpAgents
  return list
}

export function HarnessListRow({
  item,
  selected,
  onSelect,
  dragHandle,
  isDragging,
  style,
  setNodeRef,
  attributes,
  listeners,
}: {
  item: ListItem
  selected: boolean
  onSelect: () => void
  dragHandle?: boolean
  isDragging?: boolean
  style?: CSSProperties
  setNodeRef?: (node: HTMLElement | null) => void
  attributes?: ReturnType<typeof useSortable>['attributes']
  listeners?: ReturnType<typeof useSortable>['listeners']
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const Icon = resolveSessionIcon(item.provider, acpAgentId)
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group relative rounded-md', isDragging && 'z-10 bg-background opacity-80 shadow-sm')}
    >
      <SettingsNavItem
        size="lg"
        selected={selected}
        onClick={onSelect}
        className={cn(dragHandle && 'pr-7')}
        icon={Icon ? (
          <Icon status="default" size={30} renderLevel="compact" />
        ) : (
          <span className="size-[30px] shrink-0 rounded bg-muted" />
        )}
        trailing={item.experimental ? t('settings.harnesses.experimentalBadge') : undefined}
      >
        {item.label}
      </SettingsNavItem>
      {dragHandle ? (
        <button
          type="button"
          className="absolute inset-y-0 right-0 flex w-7 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing"
          aria-label={t('settings.harnesses.dragHandle')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function SortableHarnessRow({
  item,
  selected,
  disabled,
  onSelect,
}: {
  item: ListItem
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  })
  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null),
    transition,
  }
  return (
    <HarnessListRow
      item={item}
      selected={selected}
      onSelect={onSelect}
      dragHandle
      isDragging={isDragging}
      style={style}
      setNodeRef={setNodeRef}
      attributes={attributes}
      listeners={listeners}
    />
  )
}

export function HarnessesSidebar({
  loading,
  hasCatalog,
  busyKey,
  savingOrder,
  selectedKey,
  enabledItems,
  disabledItems,
  enabledOrderIds,
  sensors,
  onRefresh,
  onSelectItem,
  onDragEnd,
}: {
  loading: boolean
  hasCatalog: boolean
  busyKey: string | null
  savingOrder: boolean
  selectedKey: string | null
  enabledItems: ListItem[]
  disabledItems: ListItem[]
  enabledOrderIds: string[]
  sensors: SensorDescriptor<SensorOptions>[]
  onRefresh: () => void
  onSelectItem: (item: ListItem) => void
  onDragEnd: (event: DragEndEvent) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-border px-2.5 py-3">
      <div className="flex min-h-7 items-center justify-between gap-2 pl-2">
        <h2 className="text-lg font-semibold">{t('settings.harnesses.title')}</h2>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="size-7 p-0 text-muted-foreground"
          aria-label={t('common.refresh')}
          onClick={onRefresh}
          disabled={loading || busyKey !== null}
        >
          <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
        </Button>
      </div>

      {loading && !hasCatalog ? (
        <div className="flex items-center gap-2 px-2 pt-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          {t('settings.harnesses.loading')}
        </div>
      ) : null}

      {enabledItems.length > 0 && (
        <SettingsNavGroup label={t('settings.harnesses.groupEnabled')}>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={enabledOrderIds} strategy={verticalListSortingStrategy}>
              {enabledItems.map((item) => (
                <SortableHarnessRow
                  key={item.key}
                  item={item}
                  selected={selectedKey === item.key}
                  disabled={savingOrder || busyKey !== null}
                  onSelect={() => onSelectItem(item)}
                />
              ))}
            </SortableContext>
          </DndContext>
        </SettingsNavGroup>
      )}

      {disabledItems.length > 0 && (
        <SettingsNavGroup label={t('settings.harnesses.groupDisabled')}>
          {disabledItems.map((item) => (
            <HarnessListRow
              key={item.key}
              item={item}
              selected={selectedKey === item.key}
              onSelect={() => onSelectItem(item)}
            />
          ))}
        </SettingsNavGroup>
      )}
    </div>
  )
}

export function HarnessDetailHeaderAndStatus({
  item,
  catalog,
  enabled,
  busy,
  progress,
  showCommand,
  brandTitle,
  onEnabledChange,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  showCommand: boolean
  brandTitle: ReactNode
  onEnabledChange: (enabled: boolean) => void
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const installing = catalog?.state === 'installing' || progress?.phase === 'download'
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null
  const errorMessage =
    (progress?.phase === 'error' && progress.message) ||
    catalog?.diagnostic?.message ||
    null
  const needsAuth = !!catalog?.requiresAuth && catalog.state === 'needs_auth'
  const showProgress = installing || progress?.phase === 'download'
  const Icon = resolveSessionIcon(item.provider, acpAgentId)

  const statusRows: ReactNode[] = []
  if (item.kind === 'catalog' && catalog?.runtimeVersion) {
    statusRows.push(
      <SettingsRow key="version" label={t('settings.harnesses.fields.version')}>
        <span className="text-sm text-muted-foreground tabular-nums">{catalog.runtimeVersion}</span>
      </SettingsRow>,
    )
  }
  if (item.kind === 'catalog' && showCommand && catalog?.command) {
    statusRows.push(
      <SettingsRow
        key="command"
        label={t('settings.harnesses.fields.command')}
        footer={(
          <code className="block font-mono text-xs break-all text-muted-foreground" title={catalog.command}>
            {catalog.command}
          </code>
        )}
      />,
    )
  }
  if (item.kind === 'catalog' && needsAuth) {
    statusRows.push(
      <div key="auth" className={cn(settingsRowClassName, 'text-xs text-warning')}>
        {t('settings.harnesses.needsAuth')}
      </div>,
    )
  }
  if (showProgress) {
    statusRows.push(
      <div key="progress" className={cn(settingsRowClassName, 'space-y-1.5')}>
        <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: pct != null ? `${pct}%` : '30%' }}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          {progress && progress.total > 0
            ? t('settings.harnesses.progress', {
                received: formatBytes(progress.received),
                total: formatBytes(progress.total),
                pct: pct ?? 0,
              })
            : t('settings.harnesses.installing')}
        </p>
      </div>,
    )
  }
  if (errorMessage) {
    statusRows.push(
      <p key="error" className={cn(settingsRowClassName, 'text-xs break-words text-error')}>
        {errorMessage}
      </p>,
    )
  }
  if (item.kind === 'experimental-acp') {
    statusRows.push(
      <p key="experimental" className={cn(settingsRowClassName, 'text-xs text-muted-foreground')}>
        {t('settings.harnesses.experimentalAcpHint')}
      </p>,
    )
  }

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex min-h-8 flex-wrap items-center gap-2">
            {Icon ? <Icon status="default" size={24} renderLevel="compact" /> : null}
            {brandTitle}
            {item.experimental ? (
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] font-normal">
                {t('settings.harnesses.experimentalBadge')}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
        </div>
        <div className="flex min-h-8 shrink-0 items-center gap-2">
          {(busy || installing) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
          <Switch
            checked={enabled}
            onCheckedChange={onEnabledChange}
            disabled={busy || installing}
          />
        </div>
      </div>

      {statusRows.length > 0 ? <SettingsCard>{statusRows}</SettingsCard> : null}
    </>
  )
}

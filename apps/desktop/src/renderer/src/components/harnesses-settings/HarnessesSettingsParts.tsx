import { formatBytes } from '@superone/shared/format-bytes'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentDisplayName, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import {
  isExternalCliHarnessId,
  type ExternalCliHarnessId,
} from '@superone/shared/environment/external-cli-install'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import type { HarnessId } from '@superone/shared/session-types'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { SettingsCard, SettingsRow, settingsRowClassName } from '../settings/SettingsSection'
import { ExternalCliInstallBlock, type CliInstallUiState } from './ExternalCliInstallBlock'

export { HarnessListRow, HarnessesSidebar, SortableHarnessRow } from './HarnessesSidebar'

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

export function HarnessDetailHeaderAndStatus({
  item,
  catalog,
  enabled,
  busy,
  progress,
  cliInstall,
  showCommand,
  brandTitle,
  onEnabledChange,
  onInstallCli,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  cliInstall?: CliInstallUiState
  showCommand: boolean
  brandTitle: ReactNode
  onEnabledChange: (enabled: boolean) => void
  onInstallCli?: (harnessId: ExternalCliHarnessId) => Promise<void>
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const externalCliId =
    item.kind === 'catalog' && isExternalCliHarnessId(item.catalogId)
      ? item.catalogId
      : null
  const cliInstalling = cliInstall?.phase === 'running'
  const showExternalCliInstall = Boolean(
    externalCliId
      && onInstallCli
      && enabled
      && (
        catalog?.state === 'missing'
        || catalog?.diagnostic?.code === 'not_found'
        || cliInstalling
        || (cliInstall?.phase === 'error' && catalog?.state !== 'ready')
      ),
  )
  const installing =
    catalog?.state === 'installing' || progress?.phase === 'download' || cliInstalling
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null
  const suppressNotFoundDiagnostic =
    showExternalCliInstall && catalog?.diagnostic?.code === 'not_found'
  const errorMessage =
    (progress?.phase === 'error' && progress.message) ||
    (!suppressNotFoundDiagnostic ? catalog?.diagnostic?.message : null) ||
    null
  const needsAuth = !!catalog?.requiresAuth && catalog.state === 'needs_auth'
  const showProgress = catalog?.state === 'installing' || progress?.phase === 'download'
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
  if (showExternalCliInstall && externalCliId && onInstallCli) {
    statusRows.push(
      <div key="cli-install" className={settingsRowClassName}>
        <ExternalCliInstallBlock
          harnessId={externalCliId}
          installState={cliInstall}
          onInstall={() => onInstallCli(externalCliId)}
        />
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

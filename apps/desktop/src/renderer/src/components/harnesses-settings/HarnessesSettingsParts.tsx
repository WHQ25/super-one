import { formatBytes } from '@superone/shared/format-bytes'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUpCircle, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@superone/ui/components/ui/badge'
import { Button } from '@superone/ui/components/ui/button'
import { Switch } from '@superone/ui/components/ui/switch'
import { cn } from '@superone/ui/lib/utils'
import { acpAgentIdForHarness, isAcpProtocolHarness, isAntigravityAcpAgent, isGrokAcpAgent } from '@superone/shared/acp-brand'
import type { AcpAgentDescriptor, SettingsProvider } from '@superone/shared/agent-types'
import {
  extractCliFailureReason,
  getExternalCliInstallSpec,
  getExternalCliMinVersion,
  isExternalCliHarnessId,
  type ExternalCliHarnessId,
  type ExternalCliUpdateInfo,
} from '@superone/shared/environment/external-cli-install'
import {
  NODE_HARNESS_IDS,
  type NodeHarnessId,
} from '@superone/shared/environment/harness-installation'
import type { HarnessId } from '@superone/shared/session-types'
import { resolveSessionIcon } from '@/components/harness/resolve-session-icon'
import { SettingsCard, SettingsRow, settingsRowClassName } from '../settings/SettingsSection'
import {
  ExternalCliInstallBlock,
  ExternalCliTerminalOutput,
  type CliInstallUiState,
} from './ExternalCliInstallBlock'

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

export type ListItem = {
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
    experimental: false,
    configProvider: 'opencode',
  },
  cursor: {
    provider: 'cursor',
    labelKey: 'settings.harnesses.ids.cursor',
    descriptionKey: 'settings.harnesses.desc.cursor',
    experimental: false,
    configProvider: 'cursor',
  },
  'acp-grok': {
    provider: 'acp-grok',
    labelKey: 'settings.harnesses.ids.acp-grok',
    descriptionKey: 'settings.harnesses.desc.acpGrok',
    experimental: false,
    configProvider: 'acp-grok',
  },
  'acp-antigravity': {
    provider: 'acp-antigravity',
    labelKey: 'settings.harnesses.ids.acp-antigravity',
    descriptionKey: 'settings.harnesses.desc.acpAntigravity',
    experimental: false,
    configProvider: 'acp-antigravity',
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
  nonOpenCodeAgents: AcpAgentDescriptor[],
  t: (key: string) => string,
): ListItem[] {
  const grok = nonOpenCodeAgents.find((agent) => isGrokAcpAgent(agent.id))
  const antigravity = nonOpenCodeAgents.find((agent) => isAntigravityAcpAgent(agent.id))
  return NODE_HARNESS_IDS.map((catalogId) => {
    const meta: CatalogHarnessMeta = CATALOG_HARNESS_META[catalogId]
    const acp = isAcpProtocolHarness(catalogId)
    const agentId = acp ? acpAgentIdForHarness(catalogId) : null
    const catalogName = agentId && isAntigravityAcpAgent(agentId) ? antigravity?.name : grok?.name
    return {
      key: catalogId,
      kind: 'catalog' as const,
      catalogId,
      label: acp ? (catalogName || t(meta.labelKey)) : t(meta.labelKey),
      provider: meta.provider,
      acpAgentId: agentId,
      experimental: meta.experimental,
      description: t(meta.descriptionKey),
      configProvider: meta.configProvider,
    }
  })
}

export function HarnessDetailHeaderAndStatus({
  item,
  catalog,
  enabled,
  busy,
  progress,
  cliInstall,
  cliUpdate,
  checkingCliUpdates,
  showCommand,
  brandTitle,
  onEnabledChange,
  onInstallCli,
  onCheckCliUpdates,
}: {
  item: ListItem
  catalog?: CatalogRow
  enabled: boolean
  busy: boolean
  progress?: ProgressState
  cliInstall?: CliInstallUiState
  cliUpdate?: ExternalCliUpdateInfo
  checkingCliUpdates?: boolean
  showCommand: boolean
  brandTitle: ReactNode
  onEnabledChange: (enabled: boolean) => void
  onInstallCli?: (harnessId: ExternalCliHarnessId) => Promise<void>
  onCheckCliUpdates?: (harnessId: ExternalCliHarnessId) => Promise<void>
}) {
  const { t } = useTranslation()
  const acpAgentId = item.kind === 'catalog' ? item.acpAgentId : item.acpAgentId
  const externalCliId =
    item.kind === 'catalog' && isExternalCliHarnessId(item.catalogId)
      ? item.catalogId
      : null
  const cliInstalling = cliInstall?.phase === 'running'
  const isExternalCliIncompatible = Boolean(
    externalCliId
      && enabled
      && (catalog?.state === 'incompatible' || catalog?.diagnostic?.code === 'incompatible'),
  )
  const isExternalCliMissing = Boolean(
    externalCliId
      && enabled
      && (catalog?.state === 'missing' || catalog?.diagnostic?.code === 'not_found'),
  )
  const hasOptionalCliUpdate = Boolean(
    externalCliId
      && enabled
      && !isExternalCliIncompatible
      && !isExternalCliMissing
      && cliUpdate?.updateAvailable
      && cliUpdate.latestVersion,
  )
  const showExternalCliInstall = Boolean(
    externalCliId
      && onInstallCli
      && enabled
      && (
        isExternalCliMissing
        || isExternalCliIncompatible
        || (cliInstall?.phase === 'error' && catalog?.state !== 'ready')
      ),
  )
  const showOptionalCliUpdateTerminal = Boolean(
    externalCliId
      && !showExternalCliInstall
      && (cliInstalling || Boolean(cliInstall?.output) || cliInstall?.phase === 'error'),
  )
  const managedInstalling = catalog?.state === 'installing' || progress?.phase === 'download'
  const installing = managedInstalling || cliInstalling
  const pct =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.received / progress.total) * 100))
      : null
  const suppressExternalCliDiagnostic =
    showExternalCliInstall
    && (catalog?.diagnostic?.code === 'not_found' || catalog?.diagnostic?.code === 'incompatible')
  const errorMessage =
    (progress?.phase === 'error' && progress.message) ||
    (!suppressExternalCliDiagnostic ? catalog?.diagnostic?.message : null) ||
    null
  const needsAuth = !!catalog?.requiresAuth && catalog.state === 'needs_auth'
  const showProgress = managedInstalling
  const Icon = resolveSessionIcon(item.provider, acpAgentId)

  const statusRows: ReactNode[] = []
  if (item.kind === 'catalog' && catalog?.runtimeVersion) {
    statusRows.push(
      <SettingsRow key="version" label={t('settings.harnesses.fields.version')}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn(
              'font-mono text-sm tabular-nums',
              isExternalCliIncompatible ? 'text-warning' : 'text-muted-foreground',
            )}
          >
            {catalog.runtimeVersion}
          </span>
          {isExternalCliIncompatible && externalCliId ? (
            <Badge variant="outline" className="border-warning/40 px-1.5 py-0 text-[10px] font-normal text-warning">
              {t('settings.harnesses.cliInstall.minVersionBadge', {
                min: getExternalCliMinVersion(externalCliId),
              })}
            </Badge>
          ) : externalCliId && enabled ? (
            cliInstalling ? (
              <Loader2
                aria-label={t('settings.harnesses.cliInstall.upgrading', {
                  binary: getExternalCliInstallSpec(externalCliId).binaryName,
                })}
                className="size-3.5 animate-spin text-muted-foreground"
              />
            ) : hasOptionalCliUpdate && cliUpdate?.latestVersion && onInstallCli ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => void onInstallCli(externalCliId)}
                className="h-6 gap-1 px-2 text-xs"
              >
                <ArrowUpCircle className="size-3 text-primary" />
                {t('settings.harnesses.cliInstall.updateToVersion', {
                  latest: cliUpdate.latestVersion,
                })}
              </Button>
            ) : onCheckCliUpdates ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="size-6 p-0 text-muted-foreground"
                aria-label={t('settings.harnesses.cliInstall.checkUpdates')}
                title={t('settings.harnesses.cliInstall.checkUpdates')}
                disabled={checkingCliUpdates}
                onClick={() => void onCheckCliUpdates(externalCliId)}
              >
                <RefreshCw className={cn('size-3', checkingCliUpdates && 'animate-spin')} />
              </Button>
            ) : null
          ) : null}
        </div>
      </SettingsRow>,
    )
  }
  if (item.kind === 'catalog' && showCommand && catalog?.command) {
    statusRows.push(
      <SettingsRow key="command" label={t('settings.harnesses.fields.command')}>
        <code
          className="block max-w-full truncate font-mono text-sm text-muted-foreground"
          title={catalog.command}
        >
          {catalog.command}
        </code>
      </SettingsRow>,
    )
  }
  if (showOptionalCliUpdateTerminal && externalCliId) {
    const spec = getExternalCliInstallSpec(externalCliId)
    const failureReason =
      cliInstall?.phase === 'error'
        ? extractCliFailureReason(cliInstall.output ?? '') ?? cliInstall.message
        : null
    statusRows.push(
      <div key="cli-update-terminal" className={cn(settingsRowClassName, 'space-y-2')}>
        {(cliInstalling || Boolean(cliInstall?.output)) ? (
          <ExternalCliTerminalOutput
            title={
              cliInstalling
                ? t('settings.harnesses.cliInstall.upgrading', { binary: spec.binaryName })
                : t('common.terminal')
            }
            output={cliInstall?.output ?? ''}
            testId="settings-cli-upgrade-output"
          />
        ) : null}
        {cliInstall?.phase === 'error' ? (
          <p role="alert" className="text-xs break-words text-error">
            {failureReason
              ? `${t('settings.harnesses.cliInstall.failed', { code: cliInstall.exitCode ?? 1 })} ${failureReason}`
              : t('settings.harnesses.cliInstall.failed', { code: cliInstall.exitCode ?? 1 })}
          </p>
        ) : null}
      </div>,
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
          mode={isExternalCliIncompatible ? 'upgrade' : 'install'}
          currentVersion={catalog?.runtimeVersion}
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
          {(busy || managedInstalling) && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
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

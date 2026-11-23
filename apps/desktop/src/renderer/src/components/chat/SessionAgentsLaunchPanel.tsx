import { type ComponentType } from 'react'
import { AlertTriangle, FolderClosed, GitBranch, GitFork, Loader2, MessageSquare, RefreshCw, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { cn } from '@superone/ui/lib/utils'
import { useAppStore } from '@/stores/app'
import { localSessionLink } from '@superone/shared/session-link'
import { SessionChip } from '@superone/chat-view/presenters/SessionChip'
import {
  isHandoffLaunch,
  isLaunchModelOffered,
  isLinkLaunch,
  launchNameRoleLine,
  launchWorkDir,
  pathBasename,
  peerSessionTitle,
  shortSessionId,
} from '@superone/shared/collab-request-display'
import type {
  SessionAgentLaunchProposal,
  SessionAgentLaunchSettings,
  SessionAgentProfile,
  SessionAgentRemoteLaunch,
} from '@superone/shared/agent-types'
import { DesktopSessionLinkScope } from '@/lib/session-links'
import { HARNESS_CONTROLS } from '@/harness-ui/controls'
import { LaunchSettingsBar } from './launch-settings-bar'
import { WorkDirLabel, workDirTitle, type WorkDirState } from './work-dir-label'
import { type RemoteAgentCatalog } from './model-selector/useRemoteAgentCatalogs'

export type EditableLaunchConfig = SessionAgentLaunchSettings

function MetaChip({
  icon: Icon,
  label,
  title,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  title?: string
}) {
  return (
    <span
      title={title ?? label}
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs leading-none text-muted-foreground"
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}

function RemoteLaunchTarget({ remote }: { remote: SessionAgentRemoteLaunch }) {
  const { t } = useTranslation()
  const unseen = remote.unpushedCommits > 0 || remote.uncommittedChanges > 0
  return (
    <>
      <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
        <MetaChip icon={Server} label={remote.label} title={t('chat.sessionAgentsConfirm.remoteMachine', { machine: remote.label })} />
        {remote.projectPath ? (
          <MetaChip
            icon={FolderClosed}
            label={pathBasename(remote.projectPath)}
            title={`${t('chat.sessionAgentsConfirm.workingDirectory')}: ${remote.projectPath}`}
          />
        ) : (
          <MetaChip
            icon={FolderClosed}
            label={t('chat.sessionAgentsConfirm.remoteClone', { repository: remote.repository })}
            title={t('chat.sessionAgentsConfirm.remoteCloneInto', { url: remote.cloneUrl, directory: remote.cloneInto ?? '' })}
          />
        )}
        <MetaChip
          icon={GitBranch}
          label={remote.baseRef}
          title={t('chat.sessionAgentsConfirm.remoteBranchFrom', { ref: remote.baseRef })}
        />
      </div>
      {unseen && (
        <p className="mt-1 flex shrink-0 items-start gap-1 text-xs leading-snug text-warning">
          <AlertTriangle className="mt-px size-3 shrink-0" />
          <span>
            {t('chat.sessionAgentsConfirm.remoteUnseenChanges', {
              commits: remote.unpushedCommits,
              files: remote.uncommittedChanges,
            })}
          </span>
        </p>
      )}
    </>
  )
}

export function remoteProfileOf(
  launch: SessionAgentLaunchProposal,
  catalog: RemoteAgentCatalog | undefined,
): SessionAgentProfile | undefined {
  return catalog?.status === 'ready' ? catalog.profiles.find((profile) => profile.id === launch.agentId) : undefined
}

function RemoteModelStatus({
  remote,
  catalog,
  model,
  onRetry,
}: {
  remote: SessionAgentRemoteLaunch
  catalog: RemoteAgentCatalog | undefined
  model: string | undefined
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const machine = remote.label
  if (!catalog || catalog.status === 'loading') {
    return (
      <span className="inline-flex min-w-0 items-center gap-1 px-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        <span className="truncate">{t('chat.sessionAgentsConfirm.remoteModelsLoading', { machine })}</span>
      </span>
    )
  }
  if (catalog.status === 'error') {
    return (
      <span className="inline-flex min-w-0 items-center gap-0.5 pl-1 text-xs text-error" title={catalog.message}>
        <AlertTriangle className="size-3 shrink-0" />
        <span className="truncate">{t('chat.sessionAgentsConfirm.remoteModelsError', { machine })}</span>
        <IconButton size="sm" tooltip={t('chat.sessionAgentsConfirm.remoteModelsRetry')} onClick={onRetry}>
          <RefreshCw />
        </IconButton>
      </span>
    )
  }
  return (
    <span
      className="min-w-0 truncate px-1 text-xs text-muted-foreground"
      title={t(
        catalog.status === 'unsupported' ? 'chat.sessionAgentsConfirm.remoteCatalogUnsupported' : 'chat.sessionAgentsConfirm.remoteNoModels',
        { machine },
      )}
    >
      {model
        ? t('chat.sessionAgentsConfirm.remoteModel', { model })
        : t('chat.sessionAgentsConfirm.remoteDefaultModel', { machine })}
    </span>
  )
}

export function SessionAgentsLaunchPanel({
  launch,
  requested,
  profile,
  remoteCatalog,
  onRetryRemoteCatalog,
  onRefreshRemoteModels,
  remoteModelsLoading,
  onChange,
}: {
  launch: SessionAgentLaunchProposal
  requested: SessionAgentLaunchProposal
  profile: SessionAgentProfile | undefined
  remoteCatalog: RemoteAgentCatalog | undefined
  onRetryRemoteCatalog: () => void
  onRefreshRemoteModels?: () => void
  remoteModelsLoading?: boolean
  onChange: (patch: EditableLaunchConfig) => void
}) {
  const { t } = useTranslation()
  const { config } = launch
  const link = isLinkLaunch(launch)
  const handoff = isHandoffLaunch(launch)
  const harnessId = profile?.harnessId ?? 'claude'
  const remoteProfile = config.remote ? remoteProfileOf(launch, remoteCatalog) : undefined
  const catalogProfile = config.remote ? remoteProfile : profile
  const { LaunchModelControl } = HARNESS_CONTROLS[harnessId]
  const remoteNodesEnabled = useAppStore((s) => s.experimentalRemoteNodesEnabled)
  const workDirState: WorkDirState = launchWorkDir(config.worktree)
  const remotePicker = !!remoteProfile && remoteProfile.models.length > 0
  const requestedModelMissing = !!remoteProfile && !isLaunchModelOffered(remoteProfile, requested.config)
  const nameRole = launchNameRoleLine(launch)
  const peerTitle = peerSessionTitle(launch)
  const summary = launch.summary.trim()
  const peerProject = launch.peerProjectPath ? pathBasename(launch.peerProjectPath) : null
  const sessionShort = shortSessionId(launch.sessionId)

  return (
    <div className="flex min-h-0 flex-col px-2.5 py-2">
      <div className="mb-1.5 flex min-w-0 shrink-0 items-center gap-1 text-xs font-medium text-foreground">
        {link ? (
          <>
            <span className="shrink-0 text-muted-foreground">{t('chat.sessionAgentsConfirm.workWith')}</span>
            {launch.sessionId ? (
              <DesktopSessionLinkScope>
                <SessionChip href={localSessionLink(launch.sessionId)} label={peerTitle} className="min-w-0 translate-y-0" />
              </DesktopSessionLinkScope>
            ) : (
              <span className="min-w-0 truncate">{peerTitle}</span>
            )}
          </>
        ) : (
          <>
            {handoff && (
              <span
                className="shrink-0 text-muted-foreground"
                title={t('chat.sessionAgentsConfirm.handOffHint')}
              >
                {t('chat.sessionAgentsConfirm.handOffTo')}
              </span>
            )}
            <span className="min-w-0 truncate">{nameRole}</span>
          </>
        )}
      </div>

      {summary && (
        <div className="min-h-0 max-h-[min(50vh,calc(100dvh-14rem))] overflow-y-auto overscroll-contain">
          <p className="select-text whitespace-pre-wrap break-words text-xs leading-snug text-foreground/90">
            {summary}
          </p>
        </div>
      )}

      {link ? (
        (sessionShort || peerProject) ? (
          <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
            {sessionShort && (
              <MetaChip
                icon={MessageSquare}
                label={sessionShort}
                title={`${t('chat.sessionAgentsConfirm.peerSession')}: ${launch.sessionId}`}
              />
            )}
            {peerProject && (
              <MetaChip
                icon={FolderClosed}
                label={peerProject}
                title={
                  launch.peerProjectPath
                    ? `${t('chat.sessionAgentsConfirm.peerProject')}: ${launch.peerProjectPath}`
                    : peerProject
                }
              />
            )}
          </div>
        ) : null
      ) : (
        <>
          {config.remote ? <RemoteLaunchTarget remote={config.remote} /> : (
            <div className="mt-1.5 flex shrink-0 flex-wrap items-center gap-x-2.5 gap-y-1">
              {config.cwd && (
                <MetaChip
                  icon={FolderClosed}
                  label={pathBasename(config.cwd)}
                  title={`${t('chat.sessionAgentsConfirm.workingDirectory')}: ${config.cwd}`}
                />
              )}
              {remoteNodesEnabled && (workDirState.kind === 'activeBranch' || workDirState.kind === 'activeDetached') ? (
                <MetaChip
                  icon={GitFork}
                  label={workDirState.kind === 'activeBranch' ? workDirState.name : workDirState.hash}
                  title={workDirTitle(workDirState, t)}
                />
              ) : (
                <span
                  title={workDirTitle(workDirState, t)}
                  className={cn('inline-flex min-w-0 max-w-full items-center gap-0.5 truncate text-xs leading-none text-muted-foreground')}
                >
                  <WorkDirLabel state={workDirState} />
                </span>
              )}
            </div>
          )}

          <LaunchSettingsBar harnessId={harnessId} settings={config} onChange={onChange} className="mt-2">
            {config.remote && !remotePicker ? (
              <RemoteModelStatus
                remote={config.remote}
                catalog={remoteCatalog}
                model={config.model}
                onRetry={onRetryRemoteCatalog}
              />
            ) : (
              <LaunchModelControl
                profile={catalogProfile}
                catalog={config.remote ? 'profile' : 'local'}
                apiProviderId={config.apiProviderId}
                model={config.model ?? catalogProfile?.defaultConfig.model}
                effort={config.effort ?? catalogProfile?.defaultConfig.effort}
                offerFastMode
                fastMode={config.fastMode}
                serviceTier={config.serviceTier}
                claudeFastMode={config.claudeFastMode}
                onRefreshModels={config.remote ? onRefreshRemoteModels : undefined}
                modelsLoading={config.remote ? remoteModelsLoading : undefined}
                onChange={onChange}
              />
            )}
          </LaunchSettingsBar>
          {config.remote && requestedModelMissing && (
            <p className="mt-1 flex shrink-0 items-start gap-1 text-xs leading-snug text-warning">
              <AlertTriangle className="mt-px size-3 shrink-0" />
              <span>
                {t('chat.sessionAgentsConfirm.remoteModelUnavailable', {
                  model: requested.config.model,
                  machine: config.remote.label,
                })}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  )
}

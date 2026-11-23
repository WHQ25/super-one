import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Bot, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import { buildLaunchTabLabels, isLaunchModelOffered } from '@superone/shared/collab-request-display'
import type { SessionAgentLaunchProposal, SessionAgentRequestPayload } from '@superone/shared/agent-types'
import { hasOpenRadixOverlay } from '@/lib/radix-overlay'
import { HarnessGlyph } from './launch-settings-bar'
import { ApproveRejectBar } from './PermissionActionBar'
import { useRemoteAgentCatalogs } from './model-selector/useRemoteAgentCatalogs'
import { isFocusInChat, useChatRootRef } from './is-focus-in-chat'
import { leaveDecisionField, shouldSuppressDecisionShortcut } from './composer-slot/decision-composer-policy'
import {
  SessionAgentsLaunchPanel,
  remoteProfileOf,
  type EditableLaunchConfig,
} from './SessionAgentsLaunchPanel'

interface Props {
  payload: SessionAgentRequestPayload
  onConfirm: (launches: SessionAgentLaunchProposal[]) => void
  onReject: (feedback?: string) => void
}

export function SessionAgentsConfirmPrompt({ payload, onConfirm, onReject }: Props) {
  const { t } = useTranslation()
  const [overrides, setOverrides] = useState<Record<string, EditableLaunchConfig>>({})
  const [activeTab, setActiveTab] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [feedbackFocused, setFeedbackFocused] = useState(false)
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const chatRootRef = useChatRootRef()

  const { launches, profiles } = payload
  const remoteEnvironmentIds = useMemo(
    () => launches.flatMap((launch) => (launch.config.remote ? [launch.config.remote.environmentId] : [])),
    [launches],
  )
  const { catalogs: remoteCatalogs, retry: retryRemoteCatalog, refresh: refreshRemoteCatalog, refreshing: remoteRefreshing } = useRemoteAgentCatalogs(remoteEnvironmentIds)
  const tabLabels = useMemo(() => buildLaunchTabLabels(launches, profiles), [launches, profiles])
  const multiple = launches.length > 1
  const activeIndex = Math.min(activeTab, launches.length - 1)
  const activeLaunch = launches[activeIndex]

  const resolved = useMemo(
    () => launches.map((launch) => {
      if (launch.config.remote) {
        const { permissionMode, sandboxMode, fastMode: _fastMode, serviceTier: _serviceTier, ...selection } = overrides[launch.launchId] ?? {}
        const remoteProfile = remoteProfileOf(launch, remoteCatalogs[launch.config.remote.environmentId])
        const fallback = remoteProfile && !isLaunchModelOffered(remoteProfile, launch.config)
          ? {
              model: remoteProfile.defaultConfig.model ?? remoteProfile.models[0]?.id,
              effort: remoteProfile.defaultConfig.effort,
            }
          : {}
        return {
          ...launch,
          config: {
            ...launch.config,
            ...(remoteProfile ? { ...fallback, ...selection } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(sandboxMode ? { sandboxMode } : {}),
          },
        }
      }
      const profile = profiles.find((item) => item.id === launch.agentId)
      return {
        ...launch,
        config: {
          ...profile?.defaultConfig,
          ...launch.config,
          ...overrides[launch.launchId],
        },
      }
    }),
    [launches, overrides, profiles, remoteCatalogs],
  )

  const handleConfirm = useCallback(() => onConfirm(resolved), [onConfirm, resolved])
  const handleReject = useCallback(() => onReject(feedback.trim() || undefined), [onReject, feedback])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (shouldSuppressDecisionShortcut(event, chatRootRef?.current)) return
      if (hasOpenRadixOverlay()) return
      const typing = document.activeElement === feedbackRef.current

      if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        if (typing) {
          leaveDecisionField(feedbackRef.current)
          setActiveTab(event.shiftKey ? launches.length - 1 : 0)
          return
        }
        const next = event.shiftKey ? activeIndex - 1 : activeIndex + 1
        if (next < 0 || next >= launches.length) feedbackRef.current?.focus()
        else setActiveTab(next)
        return
      }

      if (typing) {
        if (event.key === 'Enter' && !event.isComposing) {
          event.preventDefault()
          handleReject()
        } else if (event.key === 'Escape') {
          event.preventDefault()
          leaveDecisionField(feedbackRef.current)
        }
        return
      }

      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault()
        handleConfirm()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        handleReject()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, launches.length, handleConfirm, handleReject, chatRootRef])

  if (!activeLaunch) return null

  return (
    <div
      className={cn(
        '@container mx-3 mb-1 flex min-h-0 flex-col overflow-hidden rounded-lg border border-primary/40 bg-card',
        'max-h-[min(80vh,calc(100dvh-5rem))]',
      )}
    >
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2">
        <Users className="size-3.5 shrink-0 text-primary" />
        <span className="min-w-0 truncate text-xs font-medium text-foreground">
          {t('chat.sessionAgentsConfirm.title')}
        </span>
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-0.5 text-xs tabular-nums text-muted-foreground"
          title={t('chat.sessionAgentsConfirm.subtitle', { count: launches.length })}
        >
          <Bot className="size-3 shrink-0" />
          {launches.length}
        </span>
      </div>

      <div className={cn('mt-1.5 flex shrink-0 items-stretch gap-1 px-1.5', multiple && 'border-b border-border/50')}>
        <div role={multiple ? 'tablist' : undefined} className="flex min-w-0 flex-1 gap-0.5 overflow-x-auto">
          {launches.map((launch, index) => {
            const profile = profiles.find((item) => item.id === launch.agentId)
            const selected = index === activeIndex
            const body = (
              <>
                <HarnessGlyph profile={profile} launch={launch} />
                <span className="truncate">{tabLabels[index]}</span>
              </>
            )
            if (!multiple) {
              return (
                <span key={launch.launchId} className="flex min-w-0 items-center gap-1.5 px-1 py-1 text-xs font-medium text-foreground">
                  {body}
                </span>
              )
            }
            return (
              <button
                key={launch.launchId}
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => setActiveTab(index)}
                className={cn(
                  'flex min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border-b-2 px-2 py-1 text-xs font-medium transition-colors',
                  selected ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {body}
              </button>
            )
          })}
        </div>
        {multiple && (
          <span className="flex shrink-0 items-center self-center pl-1 text-xs text-muted-foreground">
            <Kbd>⇥</Kbd>
            <span className="ml-0.5 hidden @[380px]:inline">{t('chat.sessionAgentsConfirm.hintSwitch')}</span>
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-col overflow-y-auto">
        <SessionAgentsLaunchPanel
          key={activeLaunch.launchId}
          launch={resolved[activeIndex]}
          requested={activeLaunch}
          profile={profiles.find((profile) => profile.id === activeLaunch.agentId)}
          remoteCatalog={activeLaunch.config.remote ? remoteCatalogs[activeLaunch.config.remote.environmentId] : undefined}
          onRetryRemoteCatalog={() => {
            if (activeLaunch.config.remote) retryRemoteCatalog(activeLaunch.config.remote.environmentId)
          }}
          onRefreshRemoteModels={activeLaunch.config.remote
            ? () => refreshRemoteCatalog(activeLaunch.config.remote!.environmentId)
            : undefined}
          remoteModelsLoading={activeLaunch.config.remote
            ? remoteRefreshing[activeLaunch.config.remote.environmentId]
            : undefined}
          onChange={(patch) => setOverrides((current) => ({
            ...current,
            [activeLaunch.launchId]: { ...current[activeLaunch.launchId], ...patch },
          }))}
        />
      </div>

      <div className="shrink-0 border-t border-border/50 px-2.5 py-2">
        <ApproveRejectBar
          feedbackRef={feedbackRef}
          onApprove={handleConfirm}
          onReject={handleReject}
          approveLabel={t('chat.sessionAgentsConfirm.approve')}
          rejectLabel={t('chat.sessionAgentsConfirm.reject')}
          feedback={{
            value: feedback,
            onChange: setFeedback,
            focused: feedbackFocused,
            onFocusChange: setFeedbackFocused,
          }}
        />
      </div>
    </div>
  )
}

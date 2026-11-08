import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ModSite, spinnerProps, stringProp, type SpinnerMode } from '@superone/chat-view/mod-ui'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ArrowDown, ArrowUp, Check, Clock, Copy, Loader2 } from 'lucide-react'
import type { ChatMessage } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useActiveSession, useChatStore } from '@/stores/chat'
import { formatTokens } from './chat-shared'
import { ForkButton } from './ForkButton'
import { isRealtimeVoiceMessage } from './codex-realtime-messages'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { tryCopy } from '@/lib/clipboard'
import { ApiRetryIndicator } from '@superone/chat-view/presenters/ChatMessageIndicators'
import { MessageErrorBadge } from './MessageErrorBadge'
import { MessageTimestamp } from '@superone/chat-view/presenters/MessageTime'
import {
  formatTerminalReason,
  turnFooterModel,
  ZERO_TURN_TOKENS,
  type PendingTurnPhase,
  type TurnRetryInfo,
  mcpStartupProgress,
  turnHasOutput,
} from '@superone/chat-view/presenters/turn-footer-model'

/** Token value with ↑ or ↓ arrow. Highlights while value is actively changing, fades after 1s of inactivity. */
function AnimatedToken({ value, direction, active }: { value: number; direction: 'up' | 'down'; active: boolean }) {
  const [flash, setFlash] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const prevRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setFlash(false)
      clearTimeout(timerRef.current)
      prevRef.current = value
      return () => clearTimeout(timerRef.current)
    }
    if (value > prevRef.current && prevRef.current > 0) {
      setFlash(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setFlash(false), 1000)
    }
    prevRef.current = value
    return () => clearTimeout(timerRef.current)
  }, [active, value])

  if (value <= 0) return null

  const isUp = direction === 'up'
  const flashColor = isUp ? 'text-primary' : 'text-emerald-400'
  const shouldFlash = active && flash

  return (
    <span className={cn('inline-flex items-center gap-0.5 tabular-nums transition-colors duration-500', shouldFlash && flashColor)}>
      {isUp
        ? <ArrowUp className={cn('size-3 transition-transform duration-300', shouldFlash && 'scale-110')} />
        : <ArrowDown className={cn('size-3 transition-transform duration-300', shouldFlash && 'scale-110')} />
      }
      <span>{formatTokens(value)}</span>
    </span>
  )
}

const ZERO_TOKENS = ZERO_TURN_TOKENS
const STATIC_FOOTER = { isCompacting: false, pendingApproval: false, streamingTokens: ZERO_TOKENS }

export function DurationFooter({
  message,
  copyText,
  parentIsStreaming,
  pendingTurn,
  apiRetry,
  onRetry,
  className,
}: {
  message: ChatMessage
  copyText?: string
  parentIsStreaming: boolean
  pendingTurn?: PendingTurnPhase
  apiRetry?: TurnRetryInfo | null
  onRetry?: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const activeProject = useChatStore((s) => s.activeProject)
  const sessionApiProviderId = useActiveSession((s) => s.apiProviderId)
  const runningSlashCommand = useActiveSession((s) => s.runningSlashCommand)
  const [reauthBusy, setReauthBusy] = useState(false)
  const handleReauth = useCallback(async (names: string[]) => {
    if (!activeProject) return
    setReauthBusy(true)
    try {
      for (const name of names) {
        const res = await window.app.codexMcpServerOauthLogin(activeProject, name, sessionApiProviderId ?? null)
        if (res.success) toast.success(t('chat.codex.mcpReauthSuccess', { name }))
        else toast.error(t('chat.codex.mcpReauthFailed', { name, error: res.error ?? '' }))
      }
    } finally {
      setReauthBusy(false)
    }
  }, [activeProject, sessionApiProviderId, t])
  const { isCompacting, pendingApproval, streamingTokens: rawStreamingTokens } = useActiveSession(useShallow((s) => {
    if (!parentIsStreaming) return STATIC_FOOTER
    return {
      isCompacting: s.isCompacting,
      pendingApproval: s.pendingPermissions.length > 0 || !!s.pendingQuestion || !!s.pendingPlanApproval,
      streamingTokens: s.isCompacting ? ZERO_TOKENS : s.streamingTokens,
    }
  }))
  const terminalRetry = !!apiRetry && apiRetry.phase !== undefined && apiRetry.phase !== 'retrying'
  const isStreaming = parentIsStreaming && !isCompacting && !terminalRetry
  const showActivity = isStreaming || (!!apiRetry && !terminalRetry)
  const streamingTokens = pendingTurn ? ZERO_TOKENS : rawStreamingTokens
  const frozenTokensRef = useRef(ZERO_TOKENS)
  if (isStreaming && (streamingTokens.input > 0 || streamingTokens.output > 0)) {
    frozenTokensRef.current = streamingTokens
  }
  // Stall means "should be streaming but isn't" — its 60s/120s thresholds are
  // calibrated for a turn that produces output. A local slash command legitimately
  // emits nothing for minutes, so leaving the heuristic on paints the footer amber
  // then red and tells the user it broke, which is worse than showing nothing.
  const stallLevel = useStallLevel(isStreaming && !runningSlashCommand && !apiRetry)
  const pausedMsRef = useRef(0)
  const pauseStartRef = useRef(0)
  const startTimeRef = useRef(() => {
    if (message.createdAt) {
      const t = new Date(message.createdAt).getTime()
      if (t > 0) return t
    }
    return Date.now()
  })
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (pendingApproval && !pauseStartRef.current) {
      pauseStartRef.current = Date.now()
    } else if (!pendingApproval && pauseStartRef.current) {
      pausedMsRef.current += Date.now() - pauseStartRef.current
      pauseStartRef.current = 0
    }
  }, [pendingApproval])

  useEffect(() => {
    if (!isStreaming) {
      if (pauseStartRef.current) {
        pausedMsRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = 0
      }
      return
    }
    const start = startTimeRef.current()
    const tick = () => {
      const activePause = pauseStartRef.current ? Date.now() - pauseStartRef.current : 0
      setElapsed(Date.now() - start - pausedMsRef.current - activePause)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [isStreaming])

  const footer = turnFooterModel({
    message,
    isStreaming,
    streamingTokens,
    frozenTokens: frozenTokensRef.current,
    elapsedMs: pendingTurn ? 0 : elapsed,
  })
  const { tokenInput, tokenOutput, hasTokens, showDuration } = footer
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    if (!copyText) return
    if (!(await tryCopy(copyText))) return
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const showCopy = !isStreaming && !!copyText
  // Voice segments carry a synthetic id with no truncation point in the backing
  // Codex thread, so a fork from one could never resolve.
  const showFork = !pendingTurn && !apiRetry && !isStreaming && message.status !== 'error' && !isRealtimeVoiceMessage(message)
  const { errorInfo, terminalReason } = footer
  const showError = footer.showError && !apiRetry
  const showTerminalReason = footer.showTerminalReason && !apiRetry
  const mcpStartup = message.metadata?.codex?.mcpStartup
  const mcpServers = mcpStartup ?? []
  // A local slash command (/code-review) can run for minutes emitting nothing at
  // all — no text, no tools — so without this the turn is indistinguishable from
  // a hang. The footer already owns this "nothing to show yet, but work is
  // happening" slot for MCP startup. Once the turn produces anything the output
  // is itself the progress signal, so both notices retire. Blank text does not
  // count: a streaming turn opens with an empty block before the first token lands.
  const hasTurnOutput = turnHasOutput(message)
  const startup = mcpStartupProgress(message, isStreaming)
  const failedMcp = mcpServers.filter((s) => s.status === 'failed')
  const showMcpFailure = !isStreaming && failedMcp.length > 0
  const showSlashCommand = !apiRetry && !pendingTurn && isStreaming && !!runningSlashCommand && !hasTurnOutput
  if (!apiRetry && !showActivity && !showDuration && !hasTokens && !showCopy && !showTerminalReason && !showError && !startup && !showMcpFailure && !showSlashCommand) return null

  const stallColor = isStreaming && !apiRetry ? getStallColor(stallLevel) : 'text-muted-foreground'

  return (
    // The row stays one text line tall (16px). An icon alone is 12px, and the
    // hover time would otherwise wrap onto a second line in a narrow pane.
    // Those two sit outside the flow, anchored to the end of the content.
    <div data-pending-turn={apiRetry ? undefined : pendingTurn} role={!apiRetry && pendingTurn ? 'status' : undefined} aria-live={!apiRetry && pendingTurn ? 'polite' : undefined} className={cn('group/footer mt-2 min-h-4 w-full min-w-0 text-xs transition-colors duration-500', stallColor, className)}>
      <div className="relative flex w-fit max-w-full min-h-4 min-w-0 flex-wrap items-center gap-1.5">
        {showCopy && (
          <button
            onClick={handleCopy}
            className="cursor-pointer transition-colors hover:text-foreground"
          >
            {copied
              ? <Check className="size-3 text-success" />
              : <Copy className="size-3" />
            }
          </button>
        )}
        {(showActivity || showDuration || apiRetry) && (showActivity ? (
          <ModSpinner message={message}>
            {(label) => (
              <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                <Loader2 className="size-3 animate-spin" />
                {apiRetry
                  ? <ApiRetryIndicator info={apiRetry} onRetry={onRetry} />
                  : pendingTurn
                  ? <span>{t(pendingTurn === 'creating' ? 'chat.creatingSession' : 'chat.sending')}</span>
                  : <>
                    {startup
                      ? <span>{t('chat.codex.startingMcpServers', startup)}</span>
                      : label && <span>{label}</span>}
                    {showDuration && <span>{footer.durationLabel}</span>}
                  </>}
              </span>
            )}
          </ModSpinner>
        ) : (
          <>
            {apiRetry ? <ApiRetryIndicator info={apiRetry} onRetry={onRetry} /> : <>
              <Clock className="size-3" />
              <span>{footer.durationLabel}</span>
            </>}
          </>
        ))}
        {showSlashCommand && (
          <>
            <span>·</span>
            <span>{t('chat.runningCommand', { command: runningSlashCommand!.command })}</span>
          </>
        )}
        {hasTokens && (
          <>
            {(showActivity || showDuration || !!apiRetry) && <span>·</span>}
            <AnimatedToken value={tokenInput} direction="up" active={isStreaming} />
            <AnimatedToken value={tokenOutput} direction="down" active={isStreaming} />
          </>
        )}
        {showError && (
          <>
            {(showDuration || hasTokens) && <span>·</span>}
            <MessageErrorBadge info={errorInfo!} />
          </>
        )}
        {showTerminalReason && (
          <>
            {(showDuration || hasTokens) && <span>·</span>}
            <AlertTriangle className="size-3" />
            <span>{formatTerminalReason(terminalReason!)}</span>
          </>
        )}
        {showMcpFailure && (() => {
          const reauthServers = failedMcp.filter((s) => s.failureReason === 'reauthenticationRequired')
          return (
            <>
              {(showDuration || hasTokens || showTerminalReason || showError) && <span>·</span>}
              <AlertTriangle className="size-3 text-warning" />
              {reauthServers.length > 0 ? (
                <button
                  type="button"
                  disabled={reauthBusy}
                  onClick={() => handleReauth(reauthServers.map((s) => s.name))}
                  className="text-warning underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {reauthBusy
                    ? t('chat.codex.mcpReauthenticating')
                    : t('chat.codex.mcpNeedsReauth', { name: reauthServers.map((s) => s.name).join(', ') })}
                </button>
              ) : (
                <span className="text-warning">{t('chat.codex.mcpStartupFailed', { name: failedMcp.map((s) => s.name).join(', ') })}</span>
              )}
            </>
          )
        })()}
        {!isStreaming && (showFork || message.metadata?.completedAt) && (
          <span className="pointer-events-none absolute top-0 left-full hidden h-4 items-center gap-1.5 pl-1.5 whitespace-nowrap group-hover/footer:pointer-events-auto group-hover/footer:flex has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:flex">
            <MessageTimestamp iso={message.metadata?.completedAt} className="inline-flex h-4 items-center" />
            {showFork && (
              <ForkButton
                message={message}
                className="inline-flex h-4 items-center"
              />
            )}
          </span>
        )}
      </div>
    </div>
  )
}

/** What the turn is doing, in the Spinner site's terms. */
function spinnerMode(message: ChatMessage): SpinnerMode {
  const last = message.content.at(-1)
  if (!last) return 'requesting'
  if (last.type === 'thinking') return 'thinking'
  if (last.type === 'tool_use') return last.status === 'streaming' ? 'tool-input' : 'tool-use'
  return 'responding'
}

/**
 * The running turn's indicator as the Spinner site. SuperOne draws no spinner
 * word, so it shows one only when a mod rewrote the word, message or suffix.
 */
function ModSpinner({ message, children }: { message: ChatMessage; children: (label: string | null) => ReactNode }) {
  const { t } = useTranslation()
  const word = t('chat.mods.spinnerWord')
  const mode = spinnerMode(message)
  const props = useMemo(() => spinnerProps(word, null, mode), [word, mode])
  return (
    <ModSite component="Spinner" instanceId={message.id} props={props}>
      {(p) => children(p === props ? null : `${stringProp(p, 'message', '') || stringProp(p, 'word', word)}${stringProp(p, 'suffix', '…')}`)}
    </ModSite>
  )
}

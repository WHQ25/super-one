import { useCallback, useEffect, useRef, useState } from 'react'
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
import { MessageErrorBadge } from './MessageErrorBadge'

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

const TERMINAL_REASON_LABELS: Record<string, string> = {
  max_turns: 'Max turns',
  aborted_tools: 'Aborted',
  blocking_limit: 'Blocked',
  api_error: 'API Error',
}
function formatTerminalReason(reason: string): string {
  return TERMINAL_REASON_LABELS[reason] ?? reason.replace(/_/g, ' ')
}

const ZERO_TOKENS = { input: 0, output: 0 }
const STATIC_FOOTER = { isCompacting: false, pendingApproval: false, streamingTokens: ZERO_TOKENS }

export function DurationFooter({
  message,
  copyText,
  parentIsStreaming,
  className,
}: {
  message: ChatMessage
  copyText?: string
  parentIsStreaming: boolean
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
  const isStreaming = parentIsStreaming && !isCompacting
  const streamingTokens = rawStreamingTokens
  const frozenTokensRef = useRef(ZERO_TOKENS)
  if (isStreaming && (streamingTokens.input > 0 || streamingTokens.output > 0)) {
    frozenTokensRef.current = streamingTokens
  }
  // Stall means "should be streaming but isn't" — its 60s/120s thresholds are
  // calibrated for a turn that produces output. A local slash command legitimately
  // emits nothing for minutes, so leaving the heuristic on paints the footer amber
  // then red and tells the user it broke, which is worse than showing nothing.
  const stallLevel = useStallLevel(isStreaming && !runningSlashCommand)
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

  const durationMs = isStreaming ? elapsed : (message.metadata?.durationMs ?? (elapsed || undefined))
  const ct = message.metadata?.consumedTokens
  const metaUsage = message.metadata?.usage
  const codexUsage = message.metadata?.codex?.usage
  // History / ACP: prefer consumedTokens; fall back to metadata.usage (main
  // runtime stores Grok/Claude turn spend there) then Codex last-turn usage.
  const tokenInput = isStreaming
    ? streamingTokens.input
    : (ct?.input
      ?? (metaUsage && (metaUsage.inputTokens > 0 || metaUsage.outputTokens > 0) ? metaUsage.inputTokens : undefined)
      ?? (codexUsage ? Math.max(0, codexUsage.lastInputTokens - codexUsage.lastCachedInputTokens) : undefined)
      ?? frozenTokensRef.current.input)
  const tokenOutput = isStreaming
    ? streamingTokens.output
    : (ct?.output
      ?? (metaUsage && (metaUsage.inputTokens > 0 || metaUsage.outputTokens > 0) ? metaUsage.outputTokens : undefined)
      ?? codexUsage?.lastOutputTokens
      ?? frozenTokensRef.current.output)
  const hasTokens = tokenInput > 0 || tokenOutput > 0

  const showDuration = durationMs && (isStreaming ? durationMs >= 1000 : durationMs >= 20000)
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
  const showFork = !isStreaming && message.status !== 'error' && !isRealtimeVoiceMessage(message)
  const errorInfo = message.metadata?.errorInfo
  const showError = !isStreaming && !!errorInfo
  const terminalReason = message.metadata?.terminalReason
  // The error badge already names the failure; the bare terminal-reason chip
  // would just repeat it in developer vocabulary.
  const showTerminalReason = !isStreaming && !showError && !!terminalReason && terminalReason !== 'completed' && message.status !== 'interrupted'
  const mcpStartup = message.metadata?.codex?.mcpStartup
  const mcpServers = mcpStartup ?? []
  const hasCodexItems = (message.metadata?.codex?.items?.length ?? 0) > 0
  const hasStartingMcp = mcpServers.some((server) => server.status === 'starting')
  const showMcpStartup = isStreaming && hasStartingMcp && !hasCodexItems
  const mcpReadyCount = showMcpStartup ? mcpServers.filter((s) => s.status === 'ready').length : 0
  const failedMcp = mcpServers.filter((s) => s.status === 'failed')
  const showMcpFailure = !isStreaming && failedMcp.length > 0
  // A local slash command (/code-review) can run for minutes emitting nothing at
  // all — no text, no tools — so without this the turn is indistinguishable from
  // a hang. The footer already owns this "nothing to show yet, but work is
  // happening" slot for MCP startup. Once the turn produces anything the output
  // is itself the progress signal, so the notice retires — same rule as
  // showMcpStartup deferring to hasCodexItems. Blank text does not count: a
  // streaming turn opens with an empty block before the first token lands.
  const hasTurnOutput = message.content.some((block) =>
    block.type === 'text'
      ? block.text.trim().length > 0
      : block.type === 'thinking'
        ? block.thinking.trim().length > 0
        : true,
  )
  const showSlashCommand = isStreaming && !!runningSlashCommand && !hasTurnOutput
  if (!showDuration && !hasTokens && !showCopy && !showTerminalReason && !showError && !showMcpStartup && !showMcpFailure && !showSlashCommand) return null

  const seconds = durationMs ? Math.round(durationMs / 1000) : 0
  const display = seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`

  const stallColor = isStreaming ? getStallColor(stallLevel) : 'text-muted-foreground'

  return (
    <div className={cn('group/footer mt-2 flex items-center gap-1.5 text-xs transition-colors duration-500', stallColor, className)}>
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
      {showDuration && (
        <>
          {isStreaming
            ? <Loader2 className="size-3 animate-spin" />
            : <Clock className="size-3" />
          }
          <span>{display}</span>
        </>
      )}
      {showSlashCommand && (
        <>
          {!showDuration && <Loader2 className="size-3 animate-spin" />}
          {showDuration && <span>·</span>}
          <span>{t('chat.runningCommand', { command: runningSlashCommand!.command })}</span>
        </>
      )}
      {showMcpStartup && (
        <>
          {!showDuration && <Loader2 className="size-3 animate-spin" />}
          {showDuration && <span>·</span>}
          <span>{t('chat.codex.startingMcpServers', { ready: mcpReadyCount, total: mcpServers.length })}</span>
        </>
      )}
      {hasTokens && (
        <>
          {showDuration && <span>·</span>}
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
          <AlertTriangle className="size-3 text-warning" />
          <span className="text-warning">{formatTerminalReason(terminalReason!)}</span>
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
      {showFork && (
        <ForkButton
          message={message}
          className="hidden group-hover/footer:block data-[state=open]:block"
        />
      )}
    </div>
  )
}

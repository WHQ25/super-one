import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ChevronUp, Smartphone } from 'lucide-react'
import type { DeviceLaunchCandidate, PermissionRequest } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { PermissionActionButton } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

interface Props {
  request: PermissionRequest
  onApprove: (deviceId: string) => void
  onDeny: () => void
}

function CandidateRow({
  candidate,
  selected,
  onSelect,
}: {
  candidate: DeviceLaunchCandidate
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full cursor-pointer items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/8'
          : 'border-border/70 hover:bg-accent/60',
      )}
    >
      <Smartphone
        className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')}
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">{candidate.name}</div>
        <div className="truncate text-2xs text-muted-foreground">{candidate.platform}</div>
      </div>
      {candidate.busy ? (
        <span className="shrink-0 text-2xs text-warning">
          {t('chat.deviceLaunch.busy')}
        </span>
      ) : candidate.running ? (
        <span className="shrink-0 text-2xs text-success">
          {t('chat.deviceLaunch.running')}
        </span>
      ) : (
        <span className="shrink-0 text-2xs text-muted-foreground">
          {t('chat.deviceLaunch.willBoot')}
        </span>
      )}
      {selected ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
    </button>
  )
}

/**
 * HITL for `device_request_launch` — the agent asks for a device, the user says which.
 *
 * A picker rather than a plain allow/deny because the agent is guessing from chat
 * ("the 17 Pro Max"), and the cost of guessing wrong is a 20-second boot of the wrong
 * simulator that the user then has to undo by hand. The choice rides back on
 * `formAnswers.deviceId`, so approving row 2 approves row 2 and not the suggestion.
 */
export function DeviceLaunchConfirmPrompt({ request, onApprove, onDeny }: Props) {
  const { t } = useTranslation()
  const payload = request.deviceLaunchConfirm
  const candidates = payload?.candidates ?? []
  const [selectedId, setSelectedId] = useState(
    () => payload?.suggestedId ?? candidates[0]?.id ?? '',
  )
  const [isCollapsed, setIsCollapsed] = useState(false)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const chatRootRef = useChatRootRef()

  // A new request is a new device list; keeping the old selection would approve a
  // device that is not in this prompt.
  useEffect(() => {
    setSelectedId(payload?.suggestedId ?? candidates[0]?.id ?? '')
    setIsCollapsed(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request.requestId])

  const approve = useCallback(() => {
    if (!selectedId) return
    onApprove(selectedId)
  }, [onApprove, selectedId])

  const move = useCallback((delta: number) => {
    setSelectedId((current) => {
      if (candidates.length === 0) return current
      const index = candidates.findIndex((candidate) => candidate.id === current)
      const next = (index < 0 ? 0 : index + delta + candidates.length) % candidates.length
      return candidates[next]?.id ?? current
    })
  }, [candidates])

  useEffect(() => {
    if (!isCollapsed) {
      requestAnimationFrame(() => {
        if (!canAutofocusInChatRoot(chatRootRef?.current)) return
        btnRefs.current[0]?.focus()
      })
    }
  }, [request.requestId, isCollapsed, chatRootRef])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return
      if (isCollapsed) {
        if (e.key === ' ') {
          e.preventDefault()
          setIsCollapsed(false)
        }
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        move(1)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        move(-1)
        return
      }
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
        e.preventDefault()
        approve()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onDeny()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, approve, onDeny, move, chatRootRef])

  const selected = candidates.find((candidate) => candidate.id === selectedId)

  if (isCollapsed) {
    return (
      <div className="mx-3 mb-2">
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <Smartphone className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
            {t('chat.deviceLaunch.collapsed', { device: selected?.name ?? '' })}
          </div>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => setIsCollapsed(true)}
          className="group flex w-full cursor-pointer items-start gap-3 border-b border-border/60 px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <div
            className="flex size-10 shrink-0 items-center justify-center rounded-[22%] bg-primary/10 ring-1 ring-primary/20"
            aria-hidden
          >
            <Smartphone className="size-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-xs font-medium uppercase tracking-wide text-primary">
              {t('chat.deviceLaunch.badge')}
            </div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">
              {t('chat.deviceLaunch.title')}
            </div>
          </div>
          <ChevronDown className="mt-1 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        <div className="space-y-3 px-3.5 py-3">
          {payload?.reason ? (
            <p className="text-xs leading-relaxed text-foreground/90">{payload.reason}</p>
          ) : null}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('chat.deviceLaunch.description')}
          </p>

          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {candidates.map((candidate) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                selected={candidate.id === selectedId}
                onSelect={() => setSelectedId(candidate.id)}
              />
            ))}
          </div>

          {selected?.busy ? (
            <p className="text-2xs leading-relaxed text-warning">
              {t('chat.deviceLaunch.busyWarning')}
            </p>
          ) : null}

          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-2">
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[0] = el
              }}
              tone="approve"
              kbd="⏎"
              onClick={approve}
              disabled={!selectedId}
            >
              {t('chat.deviceLaunch.approve')}
            </PermissionActionButton>
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[1] = el
              }}
              tone="reject"
              kbd="esc"
              onClick={onDeny}
            >
              {t('chat.deviceLaunch.deny')}
            </PermissionActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

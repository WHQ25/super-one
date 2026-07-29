import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Monitor, ChevronDown, ChevronUp } from 'lucide-react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { PermissionActionButton } from './PermissionActionBar'

interface Props {
  request: PermissionRequest
  onSessionAllow: () => void
  onAlwaysAllow: () => void
  onDeny: () => void
}

/**
 * HITL when Computer Use wants to observe/control a desktop app.
 * Session = this chat only; Always = persist to Settings always-allow list.
 */
export function ComputerUseGrantPrompt({
  request,
  onSessionAllow,
  onAlwaysAllow,
  onDeny,
}: Props) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const grant = request.computerUseGrant
  const app = grant?.app ?? (typeof request.input.app === 'string' ? request.input.app : 'App')
  const bundleId = grant?.bundleId
    ?? (typeof request.input.bundleId === 'string' ? request.input.bundleId : '')
  const toolName = grant?.toolName ?? request.toolName

  useEffect(() => {
    if (!isCollapsed) {
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [request.requestId, isCollapsed])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (isCollapsed) {
        if (e.key === ' ') {
          e.preventDefault()
          setIsCollapsed(false)
        }
        return
      }
      if (e.key === 'Enter' && !e.isComposing && !e.shiftKey) {
        e.preventDefault()
        onSessionAllow()
        return
      }
      if (e.key === 'Enter' && e.shiftKey && !e.isComposing) {
        e.preventDefault()
        onAlwaysAllow()
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onDeny()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, onSessionAllow, onAlwaysAllow, onDeny])

  const handleCollapse = useCallback(() => setIsCollapsed(true), [])
  const handleExpand = useCallback(() => setIsCollapsed(false), [])

  if (isCollapsed) {
    return (
      <div className="mx-3 mb-2">
        <button
          type="button"
          onClick={handleExpand}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <Monitor className="size-3.5 shrink-0 text-amber-500" />
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {t('chat.computerUseGrant.collapsed', { app })}
          </span>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2">
      <div className="rounded-lg border border-border bg-card p-3">
        <button
          type="button"
          onClick={handleCollapse}
          className="group mb-2 flex w-full cursor-pointer items-start justify-between gap-2 text-left"
        >
          <div className="flex min-w-0 items-start gap-1.5">
            <Monitor className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                {t('chat.computerUseGrant.title', { app })}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t('chat.computerUseGrant.description')}
              </p>
              {bundleId && (
                <p className="mt-1 font-mono text-[11px] text-muted-foreground/80">{bundleId}</p>
              )}
              {toolName && (
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('chat.computerUseGrant.viaTool', { tool: toolName })}
                </p>
              )}
            </div>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
          <PermissionActionButton
            ref={(el) => { btnRefs.current[0] = el }}
            tone="approve"
            kbd="⏎"
            onClick={onSessionAllow}
          >
            {t('chat.computerUseGrant.allowSession')}
          </PermissionActionButton>
          <PermissionActionButton
            ref={(el) => { btnRefs.current[1] = el }}
            tone="primary"
            kbd="⇧⏎"
            onClick={onAlwaysAllow}
          >
            {t('chat.computerUseGrant.alwaysAllow')}
          </PermissionActionButton>
          <PermissionActionButton
            ref={(el) => { btnRefs.current[2] = el }}
            tone="reject"
            kbd="esc"
            onClick={onDeny}
          >
            {t('chat.computerUseGrant.deny')}
          </PermissionActionButton>
        </div>
      </div>
    </div>
  )
}

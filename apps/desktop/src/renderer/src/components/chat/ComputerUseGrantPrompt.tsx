import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, MousePointer2 } from 'lucide-react'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { useAppIcon } from '@/hooks/use-app-icon'
import { PermissionActionButton } from './PermissionActionBar'
import { isFocusInChat } from './is-focus-in-chat'

interface Props {
  request: PermissionRequest
  onSessionAllow: () => void
  onAlwaysAllow: () => void
  onDeny: () => void
}

/**
 * App icon with payload-first then IPC fallback. Broken data URIs fall through
 * to a Computer Use glyph so the prompt never looks empty.
 */
function GrantAppIcon({
  iconDataUri,
  className,
}: {
  iconDataUri?: string
  className?: string
}) {
  const [broken, setBroken] = useState(false)
  const showImg = !!iconDataUri && !broken

  if (showImg) {
    return (
      <img
        src={iconDataUri}
        alt=""
        draggable={false}
        onError={() => setBroken(true)}
        className={cn(
          'block shrink-0 rounded-[22%] object-contain bg-background',
          className,
        )}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-[22%] bg-emerald-500/12 ring-1 ring-emerald-500/20',
        className,
      )}
      aria-hidden
    >
      <MousePointer2 className="size-[48%] text-emerald-600 dark:text-emerald-400" />
    </div>
  )
}

function MetaChip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex max-w-full items-center truncate rounded-md border border-border/70 bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground"
    >
      {children}
    </span>
  )
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

  // Always resolve via IPC so a missing main-side attach still paints an icon.
  // Payload icon wins when present (faster first paint).
  const resolvedIcon = useAppIcon(bundleId || null)
  const iconDataUri = grant?.iconDataUri || resolvedIcon

  useEffect(() => {
    if (!isCollapsed) {
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [request.requestId, isCollapsed])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!isFocusInChat()) return
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
          className="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <GrantAppIcon iconDataUri={iconDataUri} className="size-6 shadow-sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">
              {t('chat.computerUseGrant.collapsed', { app })}
            </div>
            {bundleId ? (
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {bundleId}
              </div>
            ) : null}
          </div>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>
    )
  }

  return (
    <div className="mx-3 mb-2">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Identity header */}
        <button
          type="button"
          onClick={handleCollapse}
          className="group flex w-full cursor-pointer items-start gap-3.5 border-b border-border/60 px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <GrantAppIcon
            iconDataUri={iconDataUri}
            className="size-14 shrink-0 shadow-md ring-1 ring-black/5 dark:ring-white/10"
          />

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-[11px] font-medium uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
              {t('chat.computerUseGrant.badge')}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {t('chat.computerUseGrant.title', { app })}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {bundleId ? (
                <MetaChip title={bundleId}>{bundleId}</MetaChip>
              ) : null}
              {toolName ? (
                <MetaChip title={toolName}>
                  {t('chat.computerUseGrant.viaTool', { tool: toolName })}
                </MetaChip>
              ) : null}
            </div>
          </div>

          <ChevronDown className="mt-1 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        {/* Body */}
        <div className="space-y-3 px-3.5 py-3">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('chat.computerUseGrant.description')}
          </p>

          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[0] = el
              }}
              tone="approve"
              kbd="⏎"
              onClick={onSessionAllow}
            >
              {t('chat.computerUseGrant.allowSession')}
            </PermissionActionButton>
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[1] = el
              }}
              tone="primary"
              kbd="⇧⏎"
              onClick={onAlwaysAllow}
            >
              {t('chat.computerUseGrant.alwaysAllow')}
            </PermissionActionButton>
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[2] = el
              }}
              tone="reject"
              kbd="esc"
              onClick={onDeny}
            >
              {t('chat.computerUseGrant.deny')}
            </PermissionActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

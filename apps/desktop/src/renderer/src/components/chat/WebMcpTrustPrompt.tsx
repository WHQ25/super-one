import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ChevronDown, ChevronUp, Globe, Pencil, ShieldCheck } from 'lucide-react'
import type { PermissionRequest, WebmcpTrustConfirmPayload } from '@superone/shared/agent-types'
import { cn } from '@superone/ui/lib/utils'
import { PermissionActionButton } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

export type WebMcpTrustScope = 'session' | 'always'

interface Props {
  request: PermissionRequest
  onTrust: (scope: WebMcpTrustScope) => void
  onDeny: () => void
}

function MetaChip({
  children,
  title,
  tone = 'neutral',
}: {
  children: ReactNode
  title?: string
  tone?: 'neutral' | 'warn'
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs leading-none',
        tone === 'warn'
          ? 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'border-border/70 bg-muted/40 text-muted-foreground',
      )}
    >
      {children}
    </span>
  )
}

/** Falls back to `input` when the typed payload did not survive a hop (older remote node). */
function readConfirm(request: PermissionRequest): WebmcpTrustConfirmPayload {
  if (request.webmcpTrustConfirm) return request.webmcpTrustConfirm
  const input = request.input ?? {}
  const names = Array.isArray(input.tools) ? input.tools.filter((n): n is string => typeof n === 'string') : []
  return {
    origin: typeof input.origin === 'string' ? input.origin : '',
    reason: 'first_use',
    changedTools: [],
    tools: names.map((name) => ({ name, description: '', annotations: {} })),
  }
}

/**
 * The one mandatory WebMCP decision: may this *site* offer tools to the agent at all.
 *
 * Individual calls are not confirmed here — `browser_tools_call` goes through the harness
 * permission layer like any other MCP tool. This card is what bounds which origins can ever
 * reach it, so it lists everything the site published and marks what the site claims about each.
 * All of that text is page-authored and labelled as such.
 */
export function WebMcpTrustPrompt({ request, onTrust, onDeny }: Props) {
  const { t } = useTranslation()
  const [isCollapsed, setIsCollapsed] = useState(false)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const chatRootRef = useChatRootRef()

  const confirm = readConfirm(request)
  const isRetrust = confirm.reason === 'tool_changed'
  const writerCount = confirm.tools.filter((tool) => tool.annotations.readOnlyHint === false).length

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
      if (e.isComposing) return
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        onTrust('session')
        return
      }
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault()
        onTrust('always')
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        onDeny()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isCollapsed, onTrust, onDeny, chatRootRef])

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
          <Globe className="size-5 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-foreground">
              {t('chat.webmcpTrust.collapsed', { origin: confirm.origin })}
            </div>
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
          onClick={handleCollapse}
          className="group flex w-full cursor-pointer items-start gap-3.5 border-b border-border/60 px-3.5 py-3 text-left transition-colors hover:bg-muted/30"
        >
          <div className="flex size-10 shrink-0 items-center justify-center rounded-[22%] bg-sky-500/12 ring-1 ring-sky-500/20">
            <Globe className="size-5 text-sky-600 dark:text-sky-400" />
          </div>

          <div className="min-w-0 flex-1 pt-0.5">
            <div className="text-xs font-medium uppercase tracking-wide text-sky-600 dark:text-sky-400">
              {t('chat.webmcpTrust.badge')}
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {isRetrust
                ? t('chat.webmcpTrust.titleChanged', { origin: confirm.origin })
                : t('chat.webmcpTrust.title', { origin: confirm.origin })}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <MetaChip>{t('chat.webmcpTrust.toolCount', { count: confirm.tools.length })}</MetaChip>
              {writerCount > 0 ? (
                <MetaChip tone="warn" title={t('chat.webmcpTrust.pageClaimHint')}>
                  <Pencil className="size-3" />
                  {t('chat.webmcpTrust.writerCount', { count: writerCount })}
                </MetaChip>
              ) : null}
            </div>
          </div>

          <ChevronDown className="mt-1 size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>

        <div className="space-y-3 px-3.5 py-3">
          {isRetrust ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-2">
              <AlertTriangle className="mt-px size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
                {t('chat.webmcpTrust.changedWarning', { tools: confirm.changedTools.join(', ') })}
              </p>
            </div>
          ) : null}

          <div className="space-y-1">
            <div className="text-2xs uppercase tracking-wide text-muted-foreground">
              {t('chat.webmcpTrust.toolsHeading')}
            </div>
            <ul className="max-h-52 space-y-1.5 overflow-auto rounded-lg bg-muted/40 px-2.5 py-2">
              {confirm.tools.map((tool) => (
                <li key={tool.name} className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-2xs font-medium text-foreground">{tool.name}</span>
                    {tool.changed ? (
                      <MetaChip tone="warn">{t('chat.webmcpTrust.toolChanged')}</MetaChip>
                    ) : null}
                    {tool.annotations.readOnlyHint === true ? (
                      <MetaChip title={t('chat.webmcpTrust.pageClaimHint')}>
                        <ShieldCheck className="size-3" />
                        {t('chat.webmcpTrust.readOnly')}
                      </MetaChip>
                    ) : null}
                    {tool.annotations.readOnlyHint === false ? (
                      <MetaChip tone="warn" title={t('chat.webmcpTrust.pageClaimHint')}>
                        <Pencil className="size-3" />
                        {t('chat.webmcpTrust.writes')}
                      </MetaChip>
                    ) : null}
                  </div>
                  {tool.description ? (
                    <p className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-muted-foreground">
                      {tool.description}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('chat.webmcpTrust.description')}
          </p>

          <div className="grid grid-cols-1 gap-2 @xl:grid-cols-3">
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[0] = el
              }}
              tone="approve"
              kbd="⏎"
              onClick={() => onTrust('session')}
            >
              {t('chat.webmcpTrust.trustSession')}
            </PermissionActionButton>
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[1] = el
              }}
              tone="primary"
              kbd="⇧⏎"
              onClick={() => onTrust('always')}
            >
              {t('chat.webmcpTrust.trustAlways')}
            </PermissionActionButton>
            <PermissionActionButton
              ref={(el) => {
                btnRefs.current[2] = el
              }}
              tone="reject"
              kbd="esc"
              onClick={onDeny}
            >
              {t('chat.webmcpTrust.deny')}
            </PermissionActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

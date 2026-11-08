import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { McpAppIcon } from '@superone/ui/components/ui/mcp-app-icon'
import { cn } from '@superone/ui/lib/utils'
import { AlertTriangle, ChevronDown, ChevronUp, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { requestOpenExternalLink } from '@/lib/external-link'
import { SchemaFormComposer } from '../../schema-form/SchemaFormComposer'
import type { useMcpFormResources } from '../../schema-form/use-mcp-form-resources'
import { PermissionActionButton } from '../PermissionActionBar'
import { ToolIcon } from '../ToolIcon'

export function ElicitationPermissionPrompt({
  request,
  mcpIconSrc,
  formResources,
  isCollapsed,
  onCollapsedChange,
  onRespond,
  onAllow,
  onCancel,
}: {
  request: PermissionRequest
  mcpIconSrc: string | undefined
  formResources: ReturnType<typeof useMcpFormResources>
  isCollapsed: boolean
  onCollapsedChange: (collapsed: boolean) => void
  onRespond: (
    requestId: string,
    allow: boolean,
    alwaysAllow?: boolean,
    feedback?: string,
    selectedSuggestions?: number[],
    decision?: 'cancel',
    formAnswers?: Record<string, unknown>,
  ) => void
  onAllow: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const requestId = request.requestId
  const elicitationUrl = request.elicitationUrl
  const schemaForm = request.schemaForm
  const supportsAlwaysPersist = request.supportsAlwaysPersist ?? false
  const elicitationAcceptOnOpen = request.elicitationAcceptOnOpen === true
  const [urlOpened, setUrlOpened] = useState(false)

  useEffect(() => { setUrlOpened(false) }, [requestId])

  const openElicitationUrl = useCallback(() => {
    if (!elicitationUrl) return
    requestOpenExternalLink(elicitationUrl)
    // Opening is the consent the harness waits for; otherwise the card waits for completion.
    if (elicitationAcceptOnOpen) onRespond(requestId, true)
    else setUrlOpened(true)
  }, [elicitationUrl, elicitationAcceptOnOpen, requestId, onRespond])

  const copyElicitationUrl = useCallback(() => {
    if (!elicitationUrl) return
    void navigator.clipboard?.writeText(elicitationUrl)
  }, [elicitationUrl])

  const handleAlwaysAllow = useCallback(() => {
    onRespond(requestId, true, true)
  }, [requestId, onRespond])

  const handleFormSubmit = useCallback((content: Record<string, unknown>) => {
    onRespond(requestId, true, false, undefined, undefined, undefined, content)
  }, [requestId, onRespond])

  const handleDecline = useCallback(() => {
    onRespond(requestId, false)
  }, [requestId, onRespond])

  const requester = request.serverLabel ?? request.serverName
  const message = request.message ?? `Allow ${requester ?? 'tool'}?`
  const subtitle = request.subtitle
  const riskLevel = request.riskLevel
  const riskColor = riskLevel === 'high'
    ? 'text-red-500'
    : riskLevel === 'medium'
      ? 'text-amber-500'
      : 'text-muted-foreground'
  const isUrlElicit = Boolean(elicitationUrl)
  // Who is asking: the server's icon, else the MCP mark; a flagged risk keeps the warning colour.
  const icon = (className: string) => isUrlElicit && urlOpened
    ? <Loader2 className={`${className} animate-spin ${riskColor}`} />
    : riskLevel === 'medium' || riskLevel === 'high'
      ? <AlertTriangle className={`${className} ${riskColor}`} />
      : <McpAppIcon src={mcpIconSrc} className={`${className} text-muted-foreground`} fallback={<ToolIcon icon="mcp" className={`${className} text-muted-foreground`} />} />

  return (
    <div className="mx-3 mb-1 flex min-h-0 flex-col">
      {isCollapsed && (
        <button
          type="button"
          onClick={() => onCollapsedChange(false)}
          className="flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          {icon('size-3.5 shrink-0')}
          <span className="min-w-0 flex-1 truncate text-xs text-foreground">
            {isUrlElicit && urlOpened ? t('chat.permission.waitingElicitation') : message}
          </span>
          <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
      {/* Stays mounted while collapsed so a half-filled form keeps its answers. */}
      <div className={cn('min-h-0 flex-col rounded-lg border border-border bg-card p-3', isCollapsed ? 'hidden' : 'flex')}>
        <button
          type="button"
          onClick={() => onCollapsedChange(true)}
          className="group mb-2 flex w-full shrink-0 cursor-pointer items-start justify-between gap-2 text-left"
        >
          <div className="flex items-start gap-1.5">
            {icon('mt-0.5 size-3.5 shrink-0')}
            <div className="min-w-0">
              <div className="text-xs font-medium text-foreground">
                {isUrlElicit && urlOpened ? t('chat.permission.waitingElicitation') : message}
              </div>
              {isUrlElicit && urlOpened ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {t('chat.permission.waitingElicitationHint')}
                </p>
              ) : subtitle ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
              ) : null}
            </div>
          </div>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
        </button>
        {isUrlElicit ? (
          <div className="grid shrink-0 grid-cols-2 gap-2 @xl:grid-cols-3">
            <PermissionActionButton tone="approve" onClick={openElicitationUrl}>
              <span className="inline-flex items-center gap-1">
                <ExternalLink className="size-3" />
                {urlOpened ? t('chat.permission.reopenUrl') : t('chat.permission.openUrl')}
              </span>
            </PermissionActionButton>
            <PermissionActionButton tone="neutral" onClick={copyElicitationUrl}>
              <span className="inline-flex items-center gap-1">
                <Copy className="size-3" />
                {t('chat.permission.copyUrl')}
              </span>
            </PermissionActionButton>
            <PermissionActionButton tone="reject" onClick={onCancel}>
              {t('common.cancel')}
            </PermissionActionButton>
          </div>
        ) : schemaForm ? (
          <SchemaFormComposer
            key={requestId}
            form={schemaForm}
            resources={formResources}
            requester={requester ?? 'MCP'}
            onSubmit={handleFormSubmit}
            onDecline={handleDecline}
            onCancel={onCancel}
            active={!isCollapsed}
          />
        ) : (
          <div className="grid shrink-0 grid-cols-2 gap-2 @xl:grid-cols-4">
            <PermissionActionButton tone="approve" onClick={onAllow}>
              {t('chat.permission.allow')}
            </PermissionActionButton>
            {supportsAlwaysPersist && (
              <PermissionActionButton tone="primary" onClick={handleAlwaysAllow}>
                {t('chat.permission.alwaysAllow')}
              </PermissionActionButton>
            )}
            <PermissionActionButton tone="reject" onClick={handleDecline}>
              {t('chat.permission.decline')}
            </PermissionActionButton>
            <PermissionActionButton tone="neutral" onClick={onCancel}>
              {t('common.cancel')}
            </PermissionActionButton>
          </div>
        )}
      </div>
    </div>
  )
}

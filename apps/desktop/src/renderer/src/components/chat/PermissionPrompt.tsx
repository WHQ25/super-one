import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { Circle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, AlertTriangle } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay, parseMcpToolName } from './tool-display'
import { EditDiff, WriteDiff } from './ToolBlock'
import { modes as permissionModes } from './PermissionModeSelector'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import { ElicitationForm, isElicitationFormValid } from './ElicitationForm'
import { getPermissionPromptConfig } from './permission-prompt/permission-prompt-config'

interface MiniAppToolInfo {
  appId: string
  appName: string
  toolText: string
}

function MiniAppToolLabel({ info, textSize = 'text-xs' }: { info: MiniAppToolInfo; textSize?: string }) {
  return (
    <>
      <span className={`${textSize} font-medium text-foreground`}>{info.appName}</span>
      <span className={`${textSize} text-muted-foreground`}>·</span>
      <span className={`${textSize} text-foreground`}>{info.toolText}</span>
    </>
  )
}

/** Dev-only: comma-separated tool names to show debug data in permission prompt. */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

const DEST_LABELS: Record<string, string> = {
  session: 'session',
  localSettings: 'folder',
  projectSettings: 'project',
  userSettings: 'all projects',
  cliArg: 'CLI',
}

function destLabel(destination: string): string {
  return DEST_LABELS[destination] ?? destination
}

function SuggestionContent({ s }: { s: Record<string, unknown> }) {
  const { t } = useTranslation()
  const type = s.type as string | undefined
  const destination = (s.destination as string) ?? 'session'
  const rules = s.rules as Array<{ toolName?: string; ruleContent?: string }> | undefined
  const directories = s.directories as string[] | undefined

  switch (type) {
    case 'addRules':
      return (
        <>
          Allow{' '}
          {rules?.map((r, i) => (
            <span key={i}>
              {i > 0 && ', '}
              <span className="font-medium">{r.toolName}</span>
              {r.ruleContent && <span className="text-muted-foreground">({r.ruleContent})</span>}
            </span>
          ))}
          {' '}for this {destLabel(destination)}
        </>
      )
    case 'setMode': {
      const mode = permissionModes.find((m) => m.id === s.mode)
      if (!mode) return <>Switch to {String(s.mode)}</>
      return (
        <>
          Switch to{' '}
          <span className={`inline-flex items-center gap-0.5 font-medium ${mode.color}`}>
            {mode.icon}
            {t(`chat.permissionModes.${mode.id}.label`)}
          </span>
        </>
      )
    }
    case 'addDirectories':
      return (
        <>
          Allow access to{' '}
          <span className="font-mono font-medium">{directories?.join(', ')}</span>
          {' '}for this {destLabel(destination)}
        </>
      )
    case 'replaceRules':
      return <>Replace {rules?.map((r) => [r.toolName, r.ruleContent].filter(Boolean).join(': ')).join(', ')}</>
    case 'removeRules':
      return <>Remove {rules?.map((r) => [r.toolName, r.ruleContent].filter(Boolean).join(': ')).join(', ')}</>
    case 'removeDirectories':
      return <>Remove directory: {directories?.join(', ')}</>
    default:
      return <>{JSON.stringify(s)}</>
  }
}

export function PermissionPrompt() {
  const { t } = useTranslation()
  const pendingPermission = useActiveSession((s) => s.pendingPermissions[0] ?? null)
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const respondToPermission = useChatStore((s) => s.respondToPermission)
  const setPermissionMode = useChatStore((s) => s.setPermissionMode)
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const [feedback, setFeedback] = useState('')
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set())
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const feedbackRef = useRef<HTMLInputElement>(null)

  const requestId = pendingPermission?.requestId
  const toolName = pendingPermission?.toolName
  const allowAlwaysAllow = pendingPermission?.allowAlwaysAllow
  const isElicitation = pendingPermission?.requestKind === 'mcp_elicitation'
  const elicitationForm = pendingPermission?.elicitationForm ?? []
  const supportsAlwaysPersist = pendingPermission?.supportsAlwaysPersist ?? false
  useRestoreChatInputFocus(!!requestId)
  const promptConfig = getPermissionPromptConfig(sessionProvider, allowAlwaysAllow, isElicitation)
  const isCodexDecisionPrompt = promptConfig.buttonCount === 4
  const isEditTool = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit'
  const suggestionsCount = pendingPermission?.suggestions?.length ?? 0
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})

  const apps = useMiniAppStore((s) => s.apps)
  const miniAppInfo: MiniAppToolInfo | null = useMemo(() => {
    if (!toolName) return null
    const mcpInfo = parseMcpToolName(toolName)
    if (!mcpInfo) return null
    const inner = mcpInfo.mcpToolName.match(/^(.+?)__(.+)$/)
    if (!inner) return null
    const [, slug, mcpToolNamePart] = inner
    const app = apps.find((a) => (a.manifest.toolSlug ?? a.id) === slug)
    if (!app) return null
    const toolDef = app.manifest.tools?.find((t) => t.name === mcpToolNamePart)
    return {
      appId: app.id,
      appName: app.manifest.name,
      toolText: toolDef?.displayName ?? mcpToolNamePart.replace(/_/g, ' '),
    }
  }, [toolName, apps])

  useEffect(() => {
    setFeedback('')
    setFocusedIdx(0)
    setSelectedSuggestions(new Set())
    setIsFeedbackFocused(false)
    setIsCollapsed(false)
    setFormValues({})
  }, [requestId, suggestionsCount])

  useEffect(() => {
    if (requestId && !isCollapsed) {
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [requestId, isCollapsed])

  const btnCount = promptConfig.buttonCount

  const handleDeny = useCallback(() => {
    if (!requestId) return
    respondToPermission(
      requestId,
      false,
      undefined,
      isCodexDecisionPrompt ? undefined : (feedback.trim() || undefined),
    )
  }, [requestId, respondToPermission, feedback, isCodexDecisionPrompt])

  const handleAcceptEdit = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true)
    setPermissionMode('acceptEdits')
  }, [requestId, respondToPermission, setPermissionMode])

  const handleAlwaysAllow = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true, true)
  }, [requestId, respondToPermission])

  const handleCancel = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, false, undefined, undefined, undefined, 'cancel')
  }, [requestId, respondToPermission])

  const toggleSuggestion = useCallback((idx: number) => {
    setSelectedSuggestions(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }, [])

  const handleAllow = useCallback(() => {
    if (!requestId) return
    if (isElicitation) {
      respondToPermission(requestId, true, false, undefined, undefined, undefined, formValues)
      return
    }
    if (selectedSuggestions.size > 0) {
      respondToPermission(requestId, true, undefined, undefined, [...selectedSuggestions])
    } else {
      respondToPermission(requestId, true)
    }
  }, [requestId, respondToPermission, selectedSuggestions, isElicitation, formValues])

  const handleElicitationAlwaysAllow = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true, true, undefined, undefined, undefined, formValues)
  }, [requestId, respondToPermission, formValues])

  const handleElicitationDecline = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, false)
  }, [requestId, respondToPermission])

  useEffect(() => {
    if (!requestId) return

    function onKeyDown(e: KeyboardEvent) {
      if (isCollapsed) {
        if (e.key === ' ') {
          e.preventDefault()
          setIsCollapsed(false)
        }
        return
      }

      if (e.key === 'Tab' && e.shiftKey && isEditTool && !isCodexDecisionPrompt) {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleAcceptEdit()
        return
      }

      if (!isCodexDecisionPrompt && document.activeElement === feedbackRef.current) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault()
          handleDeny()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          feedbackRef.current?.blur()
        }
        return
      }

      if (e.key === ' ') {
        e.preventDefault()
        setIsCollapsed(true)
        return
      }

      if (isCodexDecisionPrompt && e.key === 'Enter' && e.shiftKey && !e.isComposing) {
        e.preventDefault()
        handleAlwaysAllow()
        return
      }

      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        handleAllow()
        return
      }

      if (e.key === 'Escape') {
        e.preventDefault()
        if (isCodexDecisionPrompt) {
          handleDeny()
        } else {
          handleDeny()
        }
        return
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < suggestionsCount) {
          e.preventDefault()
          toggleSuggestion(idx)
        }
        return
      }

      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        const delta = e.key === 'ArrowLeft' ? -1 : 1
        setFocusedIdx((prev) => {
          const next = Math.max(0, Math.min(btnCount - 1, prev + delta))
          btnRefs.current[next]?.focus()
          return next
        })
        return
      }

      if (!isCodexDecisionPrompt && e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestId, btnCount, handleCancel, handleDeny, handleAcceptEdit, handleAllow, isCodexDecisionPrompt, isEditTool, isCollapsed, suggestionsCount, toggleSuggestion])

  if (!pendingPermission) return null

  if (isElicitation) {
    const message = pendingPermission.message ?? `Allow ${pendingPermission.serverName ?? 'tool'}?`
    const subtitle = pendingPermission.subtitle
    const riskLevel = pendingPermission.riskLevel
    const riskColor = riskLevel === 'high'
      ? 'text-red-500'
      : riskLevel === 'medium'
        ? 'text-amber-500'
        : 'text-muted-foreground'
    const formValid = isElicitationFormValid(elicitationForm, formValues)

    return (
      <div className="mx-3 mb-2">
        {isCollapsed ? (
          <button
            type="button"
            onClick={() => setIsCollapsed(false)}
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-left transition-colors hover:bg-muted"
          >
            <AlertTriangle className={`size-3.5 shrink-0 ${riskColor}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{message}</span>
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <div className="rounded-lg border border-border bg-muted/60 p-3">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-start gap-1.5">
                <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${riskColor}`} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{message}</div>
                  {subtitle && (
                    <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{subtitle}</p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCollapsed(true)}
                className="cursor-pointer text-muted-foreground hover:text-foreground"
              >
                <ChevronDown className="size-3.5" />
              </button>
            </div>
            {elicitationForm.length > 0 && (
              <ElicitationForm fields={elicitationForm} value={formValues} onChange={setFormValues} />
            )}
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              <Button
                size="sm"
                disabled={!formValid}
                className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-green-600 dark:focus:ring-green-400 focus:outline-none"
                onClick={handleAllow}
              >
                {t('chat.permission.allow')}
              </Button>
              {supportsAlwaysPersist && (
                <Button
                  size="sm"
                  disabled={!formValid}
                  className="h-7 cursor-pointer bg-blue-600 px-3 text-[11px] text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:outline-none"
                  onClick={handleElicitationAlwaysAllow}
                >
                  {t('chat.permission.alwaysAllow')}
                </Button>
              )}
              <Button
                size="sm"
                className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400 focus:outline-none"
                onClick={handleElicitationDecline}
              >
                {t('chat.permission.decline')}
              </Button>
              <Button
                size="sm"
                className="h-7 cursor-pointer border border-border bg-background/70 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-2 focus:ring-slate-400 focus:outline-none"
                onClick={handleCancel}
              >
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const display = getToolDisplay(toolName ?? '', input, cwd, homedir)
  const isBash = toolName === 'Bash'
  const isSandboxNetwork = toolName === 'SandboxNetworkAccess'
  const hasSuggestionRow = !isCodexDecisionPrompt && !!suggestions && suggestions.length > 0

  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => (toolName ?? '').toLowerCase().includes(n))

  const collapsedSummary = isSandboxNetwork
    ? (typeof input.host === 'string' ? input.host : t('chat.permission.networkAccess'))
    : (display.summary || '')

  return (
    <div className="mx-3 mb-2">
      {isCollapsed ? (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-2 text-left transition-colors hover:bg-muted"
        >
          {isSandboxNetwork ? (
            <ShieldAlert className="size-3.5 shrink-0 animate-pulse text-amber-500" />
          ) : miniAppInfo ? (
            <MiniAppIcon appId={miniAppInfo.appId} className="size-3.5 shrink-0 animate-pulse" />
          ) : (
            <ToolIcon icon={display.icon} className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />
          )}
          {isSandboxNetwork ? (
            <span className="text-xs font-medium text-foreground">{t('chat.permission.sandboxNetwork')}</span>
          ) : miniAppInfo ? (
            <MiniAppToolLabel info={miniAppInfo} />
          ) : (
            <span className="text-xs font-medium text-foreground">{toolName}</span>
          )}
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {collapsedSummary}
          </span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent side="top"><Trans i18nKey="tooltips.collapsePermission" components={{ kbd: <Kbd variant="inline" /> }} /></TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </button>
      ) : (
        <div>
            <div className="rounded-lg border border-border bg-muted/60 p-3">
              {isSandboxNetwork ? (
                <>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
                      <span className="font-medium text-amber-500">{t('chat.permission.allowSandboxNetwork')}</span>
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" onClick={() => setIsCollapsed(true)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <ChevronDown className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><Trans i18nKey="tooltips.collapsePermission" components={{ kbd: <Kbd variant="inline" /> }} /></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {typeof input.host === 'string' && input.host && (
                    <p className="mb-2 font-mono text-xs text-muted-foreground">{input.host}</p>
                  )}
                </>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      {miniAppInfo ? (
                        <MiniAppIcon appId={miniAppInfo.appId} className="size-3.5 shrink-0" />
                      ) : (
                        <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      {miniAppInfo ? (
                        <MiniAppToolLabel info={miniAppInfo} textSize="text-xs" />
                      ) : (
                        <span className="font-medium text-foreground">{toolName}</span>
                      )}
                      {isBash && typeof input.description === 'string' && input.description && (
                        <span className="min-w-0 truncate text-muted-foreground">{input.description}</span>
                      )}
                    </div>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button type="button" onClick={() => setIsCollapsed(true)} className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <ChevronDown className="size-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top"><Trans i18nKey="tooltips.collapsePermission" components={{ kbd: <Kbd variant="inline" /> }} /></TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  {isBash && !!input.dangerouslyDisableSandbox && (
                    <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                      <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                      <span className="text-xs font-medium text-amber-500">{t('chat.permission.sandboxOverride')}</span>
                    </div>
                  )}
                </>
              )}
              {!isSandboxNetwork && display.summary && (
                <p
                  className={`mb-2 text-xs text-muted-foreground ${isBash ? 'max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono' : 'truncate'}`}
                >
                  {display.summary}
                </p>
              )}
              {(toolName === 'Edit' || toolName === 'Write') && (
                <div className="mb-2 max-h-64 overflow-y-auto rounded bg-muted/50 text-xs">
                  {toolName === 'Edit' && <EditDiff params={input} />}
                  {toolName === 'Write' && <WriteDiff params={input} />}
                </div>
              )}
              {blockedPath && (
                <p className="mb-2 break-all text-xs text-amber-600 dark:text-amber-400">{t('chat.permission.blockedPath', { path: blockedPath })}</p>
              )}
              {decisionReason && (
                <p className="mb-2 text-xs text-muted-foreground">{decisionReason}</p>
              )}
              {isDebug && (
                <div className="mb-2 space-y-1">
                  <div>
                    <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">{t('chat.permission.inputHeading')}</div>
                    <div className="max-h-32 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
                      {JSON.stringify(input, null, 2)}
                    </div>
                  </div>
                  {suggestions && suggestions.length > 0 && (
                    <div>
                      <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">{t('chat.permission.suggestionsHeading')}</div>
                      <div className="max-h-32 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
                        {JSON.stringify(suggestions, null, 2)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {isCodexDecisionPrompt ? (
                  <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                    <Button
                      ref={(el) => { btnRefs.current[0] = el }}
                      size="sm"
                      className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 focus:ring-2 focus:ring-green-600 dark:focus:ring-green-400 focus:outline-none"
                      onClick={handleAllow}
                    >
                      {t('chat.permission.allow')}
                      <Kbd variant="inline" className="ml-1 text-green-200/80">⏎</Kbd>
                    </Button>
                    <Button
                      ref={(el) => { btnRefs.current[1] = el }}
                      size="sm"
                      className="h-7 cursor-pointer bg-blue-600 px-3 text-[11px] text-white hover:bg-blue-500 focus:ring-2 focus:ring-blue-600 dark:focus:ring-blue-400 focus:outline-none"
                      onClick={handleAlwaysAllow}
                    >
                      {t('chat.permission.allowForSession')}
                      <Kbd variant="inline" className="ml-1 text-blue-200/80">⇧↵</Kbd>
                    </Button>
                    <Button
                      ref={(el) => { btnRefs.current[2] = el }}
                      size="sm"
                      className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400 focus:outline-none"
                      onClick={handleDeny}
                    >
                      {t('chat.permission.decline')}
                      <Kbd variant="inline" className="ml-1 text-red-200/80">esc</Kbd>
                    </Button>
                    <Button
                      ref={(el) => { btnRefs.current[3] = el }}
                      size="sm"
                      className="h-7 cursor-pointer border border-border bg-background/70 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-2 focus:ring-slate-400 focus:outline-none"
                      onClick={handleCancel}
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      ref={(el) => { btnRefs.current[0] = el }}
                      size="sm"
                      className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 focus:ring-2 focus:ring-green-600 dark:focus:ring-green-400 focus:outline-none"
                      onClick={handleAllow}
                    >
                      {t('chat.permission.allow')}
                      {selectedSuggestions.size > 0 && (
                        <span className="ml-1 text-[10px] text-green-200/80">+{selectedSuggestions.size}</span>
                      )}
                      {!isFeedbackFocused && (
                        <Kbd variant="inline" className="ml-1 text-green-200/80">⏎</Kbd>
                      )}
                    </Button>
                    <Button
                      ref={(el) => { btnRefs.current[1] = el }}
                      size="sm"
                      className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-600 dark:focus:ring-red-400 focus:outline-none"
                      onClick={handleDeny}
                    >
                      {t('chat.permission.deny')}
                      <Kbd variant="inline" className="ml-1 text-red-200/80">{isFeedbackFocused ? '↵' : 'esc'}</Kbd>
                    </Button>
                    <div className="relative flex min-w-0 basis-full items-center @lg:basis-0 @lg:flex-1">
                      <input
                        ref={feedbackRef}
                        data-feedback
                        type="text"
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        onFocus={() => setIsFeedbackFocused(true)}
                        onBlur={() => setIsFeedbackFocused(false)}
                        placeholder={t('chat.permission.denyReasonPlaceholder')}
                        className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
                    </div>
                  </div>
                )}
                {hasSuggestionRow && (
                  <div className="grid grid-cols-1 gap-1.5">
                    {suggestions?.map((s, i) => {
                      const isSelected = selectedSuggestions.has(i)
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-[11px] transition-colors ${
                            isSelected
                              ? 'border-green-500/50 bg-green-500/10 text-green-500 hover:bg-green-500/20'
                              : 'border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                          }`}
                          onClick={() => toggleSuggestion(i)}
                        >
                          {isSelected
                            ? <CheckCircle2 className="size-3.5 shrink-0 text-green-600 dark:text-green-400" />
                            : <Circle className="size-3.5 shrink-0 text-muted-foreground/40" />
                          }
                          <span className="flex min-w-0 items-center gap-1 truncate"><SuggestionContent s={s} /></span>
                          <Kbd variant="square" className="ml-auto">{i + 1}</Kbd>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

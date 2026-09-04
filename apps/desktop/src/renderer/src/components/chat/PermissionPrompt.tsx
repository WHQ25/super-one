import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount, useScopedSessionActions } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { Circle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, AlertTriangle } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay, getToolLabel, parseMcpToolName } from './tool-display'
import { deviceToolVerbKey } from './device-tool-display'
import { EditDiff, WriteDiff } from './ToolBlock'
import { modes as permissionModes } from './PermissionModeSelector'
import { useRestoreChatInputFocus } from '@/hooks/useRestoreChatInputFocus'
import { eligibilityFromStore } from '@/lib/auto-mode-eligibility'
import { ElicitationForm, isElicitationFormValid } from './ElicitationForm'
import { getPermissionPromptConfig } from './permission-prompt/permission-prompt-config'
import { VideoGenConfirmPromptContainer } from './VideoGenConfirmPromptContainer'
import { ConfigConfirmPromptContainer } from './ConfigConfirmPromptContainer'
import { SessionAgentsConfirmPromptContainer } from './SessionAgentsConfirmPromptContainer'
import { SessionCleanupConfirmPromptContainer } from './SessionCleanupConfirmPrompt'
import { AutomationConfirmPromptContainer } from './AutomationConfirmPrompt'
import { ComputerUseGrantPrompt } from './ComputerUseGrantPrompt'
import { WebMcpTrustPrompt } from './WebMcpTrustPrompt'
import { ApproveRejectBar, PermissionActionButton } from './PermissionActionBar'
import { canAutofocusInChatRoot, isFocusInChat, useChatRootRef } from './is-focus-in-chat'

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
  const { respondToPermission, setPermissionMode } = useScopedSessionActions()
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const [feedback, setFeedback] = useState('')
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set())
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const feedbackRef = useRef<HTMLInputElement>(null)
  const chatRootRef = useChatRootRef()

  const requestId = pendingPermission?.requestId
  const toolName = pendingPermission?.toolName
  const allowAlwaysAllow = pendingPermission?.allowAlwaysAllow
  const isElicitation = pendingPermission?.requestKind === 'mcp_elicitation'
  const isVideoGenConfirm = pendingPermission?.requestKind === 'video_gen_confirm'
  const isConfigConfirm = pendingPermission?.requestKind === 'config_confirm'
  const isSessionAgentsConfirm = pendingPermission?.requestKind === 'session_agents_confirm'
  const isComputerUseGrant = pendingPermission?.requestKind === 'computer_use_grant'
  const isWebMcpTrustConfirm = pendingPermission?.requestKind === 'webmcp_trust_confirm'
  const isSessionCleanupConfirm = pendingPermission?.requestKind === 'session_cleanup_confirm'
  const isAutomationConfirm = pendingPermission?.requestKind === 'automation_confirm'
  // Deliberately NOT in `isSelfManagedConfirm`: this one keeps the standard prompt,
  // because a refusal's typed reason is what the device tool reads back to the agent.
  // It only adds a third button.
  const isDeviceControlConfirm = pendingPermission?.requestKind === 'device_control_confirm'
  const isSelfManagedConfirm =
    isVideoGenConfirm
    || isConfigConfirm
    || isSessionAgentsConfirm
    || isComputerUseGrant
    || isWebMcpTrustConfirm
    || isSessionCleanupConfirm
    || isAutomationConfirm
  const elicitationForm = pendingPermission?.elicitationForm ?? []
  const supportsAlwaysPersist = pendingPermission?.supportsAlwaysPersist ?? false
  useRestoreChatInputFocus(!!requestId)
  const promptConfig = getPermissionPromptConfig(
    sessionProvider,
    allowAlwaysAllow,
    isElicitation,
    pendingPermission?.requestKind,
  )
  const isCodexDecisionPrompt = promptConfig.buttonCount === 4
  const isEditTool = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit'
  const autoEligible = useMemo(
    () => eligibilityFromStore(account, availableModels.find((m) => m.id === selectedModel)).ok,
    [account, availableModels, selectedModel],
  )
  const fastMode = autoEligible ? 'auto' : 'acceptEdits'
  const suggestionsCount = pendingPermission?.suggestions?.length ?? 0
  const [formValues, setFormValues] = useState<Record<string, unknown>>({})

  const apps = useMiniAppStore((s) => s.apps)
  const pendingInput = pendingPermission?.input
  const miniAppInfo: MiniAppToolInfo | null = useMemo(() => {
    if (!toolName) return null
    const mcpInfo = parseMcpToolName(toolName)
    if (!mcpInfo) return null
    const params = (pendingInput && typeof pendingInput === 'object' && !Array.isArray(pendingInput))
      ? pendingInput as Record<string, unknown>
      : {}
    const resolved = resolveMiniAppToolIdentity(mcpInfo.mcpToolName, params, apps)
    if (!resolved) return null
    const app = apps.find((a) => a.id === resolved.appId)
    if (!app && resolved.legacy) return null
    return {
      appId: resolved.appId,
      appName: app?.manifest.name ?? resolved.app.manifest.name,
      toolText: resolved.toolDef?.displayName ?? resolved.toolName.replace(/_/g, ' '),
    }
  }, [toolName, apps, pendingInput])

  useEffect(() => {
    setFeedback('')
    setFocusedIdx(0)
    setSelectedSuggestions(new Set())
    setIsFeedbackFocused(false)
    setIsCollapsed(false)
    setFormValues({})
  }, [requestId, suggestionsCount])

  useEffect(() => {
    // VideoGenConfirmPrompt mounts its own window keydown listener and manages its
    // own focus — this autofocus effect must not fight it.
    // Also skip when another mosaic chat pane owns keyboard focus so a background
    // session's permission prompt cannot steal the composer caret.
    if (requestId && !isCollapsed && !isSelfManagedConfirm) {
      requestAnimationFrame(() => {
        if (!canAutofocusInChatRoot(chatRootRef?.current)) return
        btnRefs.current[0]?.focus()
      })
    }
  }, [requestId, isCollapsed, isSelfManagedConfirm, chatRootRef])

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
    setPermissionMode(fastMode)
  }, [requestId, respondToPermission, setPermissionMode, fastMode])

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
      const sugg = pendingPermission?.suggestions
      const upgradeIdx = autoEligible
        ? [...selectedSuggestions].find((i) => {
            const s = sugg?.[i]
            return s?.type === 'setMode' && s.mode === 'acceptEdits'
          })
        : undefined
      if (upgradeIdx !== undefined) {
        const rest = [...selectedSuggestions].filter((i) => i !== upgradeIdx)
        respondToPermission(requestId, true, undefined, undefined, rest.length ? rest : undefined)
        setPermissionMode('auto')
        return
      }
      respondToPermission(requestId, true, undefined, undefined, [...selectedSuggestions])
    } else {
      respondToPermission(requestId, true)
    }
  }, [requestId, respondToPermission, selectedSuggestions, isElicitation, formValues, autoEligible, pendingPermission, setPermissionMode])

  const handleElicitationAlwaysAllow = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true, true, undefined, undefined, undefined, formValues)
  }, [requestId, respondToPermission, formValues])

  const handleElicitationDecline = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, false)
  }, [requestId, respondToPermission])

  useEffect(() => {
    // VideoGenConfirmPrompt has its own window keydown listener (Tab/Enter/Escape).
    // Without this gate both listeners fire and Enter/Escape would additionally
    // trigger handleAllow/handleDeny here with the wrong payload.
    if (!requestId || isSelfManagedConfirm) return

    function onKeyDown(e: KeyboardEvent) {
      // Enter/Esc/Space/digits must not fire while the user types in another panel
      // or in a sibling mosaic chat pane.
      if (!isFocusInChat(document.activeElement, chatRootRef?.current)) return

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

      if ((isCodexDecisionPrompt || isDeviceControlConfirm) && e.key === 'Enter' && e.shiftKey && !e.isComposing) {
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
  }, [requestId, btnCount, handleCancel, handleDeny, handleAcceptEdit, handleAllow, handleAlwaysAllow, isCodexDecisionPrompt, isDeviceControlConfirm, isEditTool, isCollapsed, suggestionsCount, toggleSuggestion, isSelfManagedConfirm, chatRootRef])

  if (!pendingPermission) return null

  if (isVideoGenConfirm) {
    return <VideoGenConfirmPromptContainer request={pendingPermission} />
  }

  if (isConfigConfirm) {
    return <ConfigConfirmPromptContainer request={pendingPermission} />
  }

  if (isSessionAgentsConfirm) {
    return <SessionAgentsConfirmPromptContainer request={pendingPermission} />
  }

  if (isSessionCleanupConfirm) {
    return <SessionCleanupConfirmPromptContainer request={pendingPermission} />
  }

  if (isAutomationConfirm) {
    return <AutomationConfirmPromptContainer request={pendingPermission} />
  }

  if (isWebMcpTrustConfirm && pendingPermission) {
    return (
      <WebMcpTrustPrompt
        request={pendingPermission}
        onTrust={(scope) => {
          if (!requestId) return
          respondToPermission(requestId, true, scope === 'always', undefined, undefined, undefined, { scope })
        }}
        onDeny={() => {
          if (!requestId) return
          respondToPermission(requestId, false)
        }}
      />
    )
  }

  if (isComputerUseGrant && pendingPermission) {
    return (
      <ComputerUseGrantPrompt
        request={pendingPermission}
        onSessionAllow={() => {
          if (!requestId) return
          respondToPermission(requestId, true, false)
        }}
        onAlwaysAllow={() => {
          if (!requestId) return
          respondToPermission(requestId, true, true)
        }}
        onDeny={() => {
          if (!requestId) return
          respondToPermission(requestId, false)
        }}
      />
    )
  }

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
            className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
          >
            <AlertTriangle className={`size-3.5 shrink-0 ${riskColor}`} />
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">{message}</span>
            <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        ) : (
          <div className="rounded-lg border border-border bg-card p-3">
            <button
              type="button"
              onClick={() => setIsCollapsed(true)}
              className="group mb-2 flex w-full cursor-pointer items-start justify-between gap-2 text-left"
            >
              <div className="flex items-start gap-1.5">
                <AlertTriangle className={`mt-0.5 size-3.5 shrink-0 ${riskColor}`} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground">{message}</div>
                  {subtitle && (
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{subtitle}</p>
                  )}
                </div>
              </div>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
            </button>
            {elicitationForm.length > 0 && (
              <ElicitationForm fields={elicitationForm} value={formValues} onChange={setFormValues} />
            )}
            <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
              <PermissionActionButton tone="approve" disabled={!formValid} onClick={handleAllow}>
                {t('chat.permission.allow')}
              </PermissionActionButton>
              {supportsAlwaysPersist && (
                <PermissionActionButton tone="primary" disabled={!formValid} onClick={handleElicitationAlwaysAllow}>
                  {t('chat.permission.alwaysAllow')}
                </PermissionActionButton>
              )}
              <PermissionActionButton tone="reject" onClick={handleElicitationDecline}>
                {t('chat.permission.decline')}
              </PermissionActionButton>
              <PermissionActionButton tone="neutral" onClick={handleCancel}>
                {t('common.cancel')}
              </PermissionActionButton>
            </div>
          </div>
        )}
      </div>
    )
  }

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const displaySuggestions = autoEligible
    ? suggestions?.map((s) => (s.type === 'setMode' && s.mode === 'acceptEdits' ? { ...s, mode: 'auto' } : s))
    : suggestions
  const display = getToolDisplay(toolName ?? '', input, cwd, homedir)
  // A first-party tool keeps the words its own chat row uses. Only the generic
  // fallback is shared with third-party MCP servers.
  const deviceLabelKey = deviceToolVerbKey(toolName ?? '', input)
  const toolLabel = deviceLabelKey
    ? t(`chat.toolBlock.device.${deviceLabelKey}`)
    : getToolLabel(toolName ?? '')
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
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
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
            <span className="text-xs font-medium text-foreground">{toolLabel}</span>
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
            <div className="rounded-lg border border-border bg-card p-3">
              {isSandboxNetwork ? (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={() => setIsCollapsed(true)} className="group mb-2 flex w-full cursor-pointer items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
                            <span className="font-medium text-amber-500">{t('chat.permission.allowSandboxNetwork')}</span>
                          </div>
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><Trans i18nKey="tooltips.collapsePermission" components={{ kbd: <Kbd variant="inline" /> }} /></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  {typeof input.host === 'string' && input.host && (
                    <p className="mb-2 font-mono text-xs text-muted-foreground">{input.host}</p>
                  )}
                </>
              ) : (
                <>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" onClick={() => setIsCollapsed(true)} className="group mb-2 flex w-full cursor-pointer items-center justify-between gap-2 text-xs">
                          <div className="flex min-w-0 items-center gap-1.5">
                            {miniAppInfo ? (
                              <MiniAppIcon appId={miniAppInfo.appId} className="size-3.5 shrink-0" />
                            ) : (
                              <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            {miniAppInfo ? (
                              <MiniAppToolLabel info={miniAppInfo} textSize="text-xs" />
                            ) : (
                              <span className="font-medium text-foreground">{toolLabel}</span>
                            )}
                            {isBash && typeof input.description === 'string' && input.description && (
                              <span className="min-w-0 truncate text-muted-foreground">{input.description}</span>
                            )}
                          </div>
                          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top"><Trans i18nKey="tooltips.collapsePermission" components={{ kbd: <Kbd variant="inline" /> }} /></TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                <div
                  className="mb-2 max-h-64 overflow-y-auto rounded bg-muted/50 text-xs"
                  style={{ '--diff-gutter-bg': 'color-mix(in oklch, var(--card), var(--muted) 50%)' } as React.CSSProperties}
                >
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
                    <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">{t('chat.permission.inputHeading')}</div>
                    <div className="max-h-32 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
                      {JSON.stringify(input, null, 2)}
                    </div>
                  </div>
                  {suggestions && suggestions.length > 0 && (
                    <div>
                      <div className="mb-0.5 text-xs font-medium uppercase text-muted-foreground">{t('chat.permission.suggestionsHeading')}</div>
                      <div className="max-h-32 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-foreground whitespace-pre-wrap break-all">
                        {JSON.stringify(suggestions, null, 2)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2">
                {isCodexDecisionPrompt ? (
                  <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
                    <PermissionActionButton
                      ref={(el) => { btnRefs.current[0] = el }}
                      tone="approve"
                      kbd="⏎"
                      onClick={handleAllow}
                    >
                      {t('chat.permission.allow')}
                    </PermissionActionButton>
                    <PermissionActionButton
                      ref={(el) => { btnRefs.current[1] = el }}
                      tone="primary"
                      kbd="⇧↵"
                      onClick={handleAlwaysAllow}
                    >
                      {t('chat.permission.allowForSession')}
                    </PermissionActionButton>
                    <PermissionActionButton
                      ref={(el) => { btnRefs.current[2] = el }}
                      tone="reject"
                      kbd="esc"
                      onClick={handleDeny}
                    >
                      {t('chat.permission.decline')}
                    </PermissionActionButton>
                    <PermissionActionButton
                      ref={(el) => { btnRefs.current[3] = el }}
                      tone="neutral"
                      onClick={handleCancel}
                    >
                      {t('common.cancel')}
                    </PermissionActionButton>
                  </div>
                ) : (
                  <ApproveRejectBar
                    approveRef={(el) => { btnRefs.current[0] = el }}
                    rejectRef={(el) => { btnRefs.current[isDeviceControlConfirm ? 2 : 1] = el }}
                    feedbackRef={feedbackRef}
                    onApprove={handleAllow}
                    onReject={handleDeny}
                    // Two answers that differ only in lifetime read as the same word
                    // unless both say theirs. "Allow" next to "Always Allow" invites
                    // the user to assume the first one also sticks.
                    {...(isDeviceControlConfirm
                      ? { approveLabel: t('chat.permission.allowForSession') }
                      : {})}
                    approveSuffix={selectedSuggestions.size > 0 && (
                      <span className="ml-1 text-xs text-success-foreground/70">+{selectedSuggestions.size}</span>
                    )}
                    extraActions={isDeviceControlConfirm && (
                      <PermissionActionButton
                        ref={(el) => { btnRefs.current[1] = el }}
                        tone="primary"
                        kbd="⇧⏎"
                        onClick={handleAlwaysAllow}
                      >
                        {t('chat.permission.alwaysAllowDevice')}
                      </PermissionActionButton>
                    )}
                    feedback={{
                      value: feedback,
                      onChange: setFeedback,
                      focused: isFeedbackFocused,
                      onFocusChange: setIsFeedbackFocused,
                    }}
                  />
                )}
                {hasSuggestionRow && (
                  <div className="grid grid-cols-1 gap-1.5">
                    {displaySuggestions?.map((s, i) => {
                      const isSelected = selectedSuggestions.has(i)
                      const mode = s.type === 'setMode' ? permissionModes.find((m) => m.id === s.mode) : undefined
                      return (
                        <button
                          key={i}
                          type="button"
                          className={`flex h-7 w-full cursor-pointer items-center gap-1.5 rounded border px-2.5 text-xs transition-colors ${
                            isSelected
                              ? (mode
                                  ? `border-transparent ${mode.activeBg} ${mode.color}`
                                  : 'border-success/50 bg-success/10 text-success hover:bg-success/20')
                              : (mode
                                  ? `border-border text-muted-foreground ${mode.hoverBg}`
                                  : 'border-border text-muted-foreground hover:bg-success/10 hover:text-success')
                          }`}
                          onClick={() => toggleSuggestion(i)}
                        >
                          {isSelected
                            ? <CheckCircle2 className={`size-3.5 shrink-0 ${mode ? '' : 'text-success'}`} />
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

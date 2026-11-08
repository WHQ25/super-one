import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import type { TerminalCommandRuleScope } from '@superone/shared/terminal-command-rules'
import type { PermissionRequest } from '@superone/shared/agent-types'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@superone/ui/components/ui/tooltip'
import { useChatStore, useActiveSession, selectClaudeModels, selectClaudeAccount, useScopedSessionActions } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { McpAppIcon } from '@superone/ui/components/ui/mcp-app-icon'
import { ChevronDown, ChevronUp, ShieldAlert, SquareTerminal, FolderOpen } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay, getToolLabel, parseMcpToolName } from './tool-display'
import { useMcpServerIcon } from './use-mcp-server-icon'
import { deviceToolVerbKey } from './device-tool-display'
import { EditDiff, WriteDiff } from './ToolBlock'
import { eligibilityFromStore } from '@/lib/auto-mode-eligibility'
import { useMcpFormResources } from '../schema-form/use-mcp-form-resources'
import { getPermissionPromptConfig } from './permission-prompt/permission-prompt-config'
import { PermissionDetails } from './permission-prompt/PermissionDetails'
import { ElicitationPermissionPrompt } from './permission-prompt/ElicitationPermissionPrompt'
import { PermissionSuggestionRows, TerminalRuleRows } from './permission-prompt/PermissionSuggestionRows'
import { isHostConfirmRequest, SelfManagedConfirmPrompt } from './permission-prompt/SelfManagedConfirmPrompt'
import { usePermissionPromptKeyboard } from './permission-prompt/use-permission-prompt-keyboard'
import { permissionDetailSummary } from '@superone/shared/permission-details'
import { canRememberPermission, permissionPresentation } from '@superone/shared/permission-presentation'
import { shortenPath } from '@superone/shared/path-display'
import { ApproveRejectBar, PermissionActionButton } from './PermissionActionBar'
import { useChatRootRef } from './is-focus-in-chat'

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

export function PermissionPrompt({ request }: { request?: PermissionRequest }) {
  const { t } = useTranslation()
  const livePermission = useActiveSession((s) => s.pendingPermissions[0])
  const pendingPermission = request === undefined ? livePermission : request
  const sessionProvider = useActiveSession((s) => s.sessionProvider)
  const { respondToPermission, setPermissionMode } = useScopedSessionActions()
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const account = useChatStore(selectClaudeAccount)
  const availableModels = useChatStore(selectClaudeModels)
  const selectedModel = useActiveSession((s) => s.selectedModel)
  const [feedback, setFeedback] = useState('')
  const [, setFocusedIdx] = useState(0)
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<number>>(new Set())
  const [isFeedbackFocused, setIsFeedbackFocused] = useState(false)
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [rememberRequestId, setRememberRequestId] = useState<string | null>(null)
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const feedbackRef = useRef<HTMLTextAreaElement>(null)
  const chatRootRef = useChatRootRef()

  const requestId = pendingPermission?.requestId
  const toolName = pendingPermission?.toolName
  const allowAlwaysAllow = !pendingPermission?.requiresHumanApproval && (pendingPermission?.allowAlwaysAllow ?? false)
  const isScopedPermission = !!pendingPermission?.permissionDetails && !pendingPermission.requestKind
  const hasScopedAlways = !!pendingPermission && canRememberPermission(pendingPermission)
  const rememberPreview = rememberRequestId === requestId && hasScopedAlways
  // Harness asked for a decline-first prompt: focus lands on Deny and Enter must
  // not approve. Only the two-button Claude row honours it; Codex never sets it.
  const defaultToNo = pendingPermission?.defaultToNo === true
  const isElicitation = pendingPermission?.requestKind === 'mcp_elicitation'
  const formResources = useMcpFormResources(requestId, isElicitation && sessionProvider === 'codex')
  // Deliberately NOT in `isSelfManagedConfirm`: this one keeps the standard prompt,
  // because a refusal's typed reason is what the device tool reads back to the agent.
  // It only adds a third button.
  const isDeviceControlConfirm = pendingPermission?.requestKind === 'device_control_confirm'
  const isTerminalCommandConfirm = pendingPermission?.requestKind === 'terminal_command_confirm'
  // Terminal keeps Allow / Deny and offers the command rule under them as two
  // mutually exclusive toggle rows — remember for this session, or for the project —
  // shaped like Claude's rule suggestions so both read the same.
  const terminalRule = isTerminalCommandConfirm && pendingPermission?.allowAlwaysAllow && typeof pendingPermission.input.rule === 'string'
    ? pendingPermission.input.rule
    : null
  const [rememberRule, setRememberRule] = useState<TerminalCommandRuleScope | null>(null)
  const toggleRememberRule = useCallback((scope: TerminalCommandRuleScope) => {
    setRememberRule((current) => (current === scope ? null : scope))
  }, [])
  const schemaForm = pendingPermission?.schemaForm
  const elicitationUrl = pendingPermission?.elicitationUrl
  // The form composer owns its keys: Space and Enter belong to its fields.
  const isSchemaFormElicitation = isElicitation && Boolean(schemaForm) && !elicitationUrl
  const isHostConfirm = isHostConfirmRequest(pendingPermission)
  const isSelfManagedConfirm = isHostConfirm || isSchemaFormElicitation
  const promptConfig = getPermissionPromptConfig(
    sessionProvider,
    allowAlwaysAllow,
    isElicitation,
    pendingPermission?.requestKind,
  )
  const isCodexDecisionPrompt = !isScopedPermission && promptConfig.buttonCount === 4
  // Host confirms that add a third "always" button between approve and reject.
  const hasHostAlwaysButton = promptConfig.buttonCount === 3
  const hasAlwaysButton = hasHostAlwaysButton || (hasScopedAlways && !rememberPreview)
  const isEditTool = !isScopedPermission && (toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit')
  const autoEligible = useMemo(
    () => eligibilityFromStore(account, availableModels.find((m) => m.id === selectedModel)).ok,
    [account, availableModels, selectedModel],
  )
  const fastMode = autoEligible ? 'auto' : 'acceptEdits'
  const suggestionsCount = pendingPermission?.suggestions?.length ?? 0

  const apps = useMiniAppStore((s) => s.apps)
  const pendingInput = pendingPermission?.input
  // Hooks must precede the per-kind early returns below.
  const mcpIconSrc = useMcpServerIcon(isElicitation ? pendingPermission?.serverName : parseMcpToolName(toolName ?? '')?.serverName)
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
    setRememberRule(null)
    setIsFeedbackFocused(false)
    setIsCollapsed(false)
  }, [requestId, suggestionsCount])

  const btnCount = rememberPreview ? 2 : hasScopedAlways ? 3 : promptConfig.buttonCount

  const handleDeny = useCallback(() => {
    if (!requestId) return
    if (rememberPreview) { setRememberRequestId(null); return }
    respondToPermission(
      requestId,
      false,
      undefined,
      isCodexDecisionPrompt ? undefined : (feedback.trim() || undefined),
    )
  }, [requestId, respondToPermission, feedback, isCodexDecisionPrompt, rememberPreview])

  const handleAcceptEdit = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true)
    setPermissionMode(fastMode)
  }, [requestId, respondToPermission, setPermissionMode, fastMode])

  const handleAlwaysAllow = useCallback(() => {
    if (!requestId) return
    if (isScopedPermission) {
      if (hasScopedAlways) setRememberRequestId(requestId)
      return
    }
    respondToPermission(requestId, true, true)
  }, [requestId, respondToPermission, isScopedPermission, hasScopedAlways])

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
    if (rememberPreview && hasScopedAlways) { respondToPermission(requestId, true, true); return }
    if (isElicitation) {
      respondToPermission(requestId, true)
      return
    }
    if (terminalRule && rememberRule) {
      // `alwaysAllow` stays the generic "remember" flag; the lifetime rides in formAnswers.
      respondToPermission(requestId, true, rememberRule === 'project', undefined, undefined, undefined, { scope: rememberRule })
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
  }, [requestId, respondToPermission, selectedSuggestions, isElicitation, autoEligible, pendingPermission, setPermissionMode, terminalRule, rememberRule, rememberPreview, hasScopedAlways])

  usePermissionPromptKeyboard({
    requestId,
    isCollapsed,
    setIsCollapsed,
    isSelfManagedConfirm,
    chatRootRef,
    defaultToNo,
    isCodexDecisionPrompt,
    hasAlwaysButton,
    hasScopedAlways,
    rememberPreview,
    isScopedPermission,
    isEditTool,
    btnCount,
    btnRefs,
    feedbackRef,
    setFocusedIdx,
    terminalRule,
    toggleRememberRule,
    suggestionsCount,
    toggleSuggestion,
    handleAllow,
    handleAlwaysAllow,
    handleDeny,
    handleAcceptEdit,
  })

  if (!pendingPermission) return null

  if (isHostConfirm) {
    return <SelfManagedConfirmPrompt request={pendingPermission} onRespond={respondToPermission} />
  }

  if (isElicitation) {
    return (
      <ElicitationPermissionPrompt
        request={pendingPermission}
        mcpIconSrc={mcpIconSrc}
        formResources={formResources}
        isCollapsed={isCollapsed}
        onCollapsedChange={setIsCollapsed}
        onRespond={respondToPermission}
        onAllow={handleAllow}
        onCancel={handleCancel}
      />
    )
  }

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const displaySuggestions = autoEligible
    ? suggestions?.map((s) => (s.type === 'setMode' && s.mode === 'acceptEdits' ? { ...s, mode: 'auto' } : s))
    : suggestions
  const scopedPresentation = permissionPresentation(pendingPermission)
  const display = scopedPresentation ? { icon: scopedPresentation.icon === 'folder' ? 'folder-search' as const : scopedPresentation.icon, summary: permissionDetailSummary(pendingPermission) }
    : getToolDisplay(toolName ?? '', input, cwd, homedir)
  const scopedGlyph = scopedPresentation?.icon === 'folder'
    ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
    : <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />
  const toolGlyph = isTerminalCommandConfirm
    ? <SquareTerminal className="size-3.5 shrink-0 text-muted-foreground" />
    : scopedPresentation ? scopedGlyph
      : <McpAppIcon src={mcpIconSrc} className="size-3.5 shrink-0 text-muted-foreground" fallback={<ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />} />
  // A first-party tool keeps the words its own chat row uses. Only the generic
  // fallback is shared with third-party MCP servers.
  const deviceLabelKey = deviceToolVerbKey(toolName ?? '', input)
  const terminalAction = isTerminalCommandConfirm && (input.action === 'run' || input.action === 'attach' || input.action === 'close')
    ? input.action
    : null
  const toolLabel = scopedPresentation
    ? rememberPreview ? t('chat.permission.scoped.rememberTitle') : t(`chat.permission.scoped.titles.${scopedPresentation.kind}`, {
      target: ['externalDirectory', 'read', 'edit', 'list'].includes(scopedPresentation.kind) ? shortenPath(scopedPresentation.target, cwd, homedir) : scopedPresentation.target,
    })
    : terminalAction
    ? t(`chat.permission.terminal.${terminalAction}`)
    : deviceLabelKey
      ? t(`chat.toolBlock.device.${deviceLabelKey}`)
      : getToolLabel(toolName ?? '')
  const isBash = toolName === 'Bash'
  const isSandboxNetwork = toolName === 'SandboxNetworkAccess'
  const hasSuggestionRow = !isCodexDecisionPrompt && !!suggestions && suggestions.length > 0

  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => (toolName ?? '').toLowerCase().includes(n))

  const collapsedSummary = isSandboxNetwork
    ? (typeof input.host === 'string' ? input.host : t('chat.permission.networkAccess'))
    : rememberPreview ? pendingPermission.permissionDetails?.save?.join('\n') || ''
      : permissionDetailSummary(pendingPermission, display.summary)

  return (
    <div className="mx-3 mb-1 flex min-h-0 flex-col">
      {isCollapsed ? (
        <button
          type="button"
          onClick={() => setIsCollapsed(false)}
          className="flex w-full shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          {isSandboxNetwork ? (
            <ShieldAlert className="size-3.5 shrink-0 animate-pulse text-amber-500" />
          ) : scopedPresentation ? (
            scopedGlyph
          ) : miniAppInfo ? (
            <MiniAppIcon appId={miniAppInfo.appId} className="size-3.5 shrink-0 animate-pulse" />
          ) : (
            <McpAppIcon src={mcpIconSrc} className="size-3.5 shrink-0 animate-pulse text-muted-foreground" fallback={<ToolIcon icon={display.icon} className="size-3.5 shrink-0 animate-pulse text-muted-foreground" />} />
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
        <div className="flex min-h-0 flex-col">
            <div className="flex min-h-0 flex-col rounded-lg border border-border bg-card p-3">
              {isSandboxNetwork ? (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={() => setIsCollapsed(true)} className="group mb-2 flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 text-xs">
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
              ) : (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button type="button" onClick={() => setIsCollapsed(true)} className="group mb-2 flex w-full shrink-0 cursor-pointer items-center justify-between gap-2 text-xs">
                        <div className="flex min-w-0 items-center gap-1.5">
                          {miniAppInfo ? (
                            <MiniAppIcon appId={miniAppInfo.appId} className="size-3.5 shrink-0" />
                          ) : toolGlyph}
                          {miniAppInfo ? (
                            <MiniAppToolLabel info={miniAppInfo} textSize="text-xs" />
                          ) : (
                            <span className={scopedPresentation ? 'min-w-0 break-all font-medium text-foreground' : 'font-medium text-foreground'}>{toolLabel}</span>
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
              )}
              <div className="-mx-3 mb-2 min-h-0 space-y-2 overflow-y-auto px-3 empty:mb-0">
              {isSandboxNetwork && typeof input.host === 'string' && input.host && (
                <p className="font-mono text-xs text-muted-foreground">{input.host}</p>
              )}
              {isBash && !!input.dangerouslyDisableSandbox && (
                <div className="flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                  <span className="text-xs font-medium text-amber-500">{t('chat.permission.sandboxOverride')}</span>
                </div>
              )}
              <PermissionDetails request={pendingPermission} summary={scopedPresentation ? undefined : display.summary} remembering={rememberPreview} />
              {!pendingPermission.permissionDetails && !isSandboxNetwork && display.summary && (
                <p
                  className={`text-xs text-muted-foreground ${isBash ? 'max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono' : 'truncate'}`}
                >
                  {display.summary}
                </p>
              )}
              {terminalAction && (
                <div className="space-y-1 text-xs">
                  {typeof input.description === 'string' && input.description && (
                    <p className="text-muted-foreground">{input.description}</p>
                  )}
                  <p className="max-h-32 overflow-y-auto whitespace-pre-wrap break-all rounded bg-muted/50 px-2 py-1.5 font-mono text-foreground">
                    {typeof input.command === 'string' ? input.command : ''}
                  </p>
                  <p className="truncate font-mono text-muted-foreground" title={typeof input.cwd === 'string' ? input.cwd : undefined}>
                    {typeof input.tab === 'string' && input.tab ? `${input.tab} · ` : ''}{typeof input.cwd === 'string' ? input.cwd : ''}
                  </p>
                </div>
              )}
              {(toolName === 'Edit' || toolName === 'Write') && (
                <div
                  className="max-h-64 overflow-y-auto rounded bg-muted/50 text-xs"
                  style={{ '--diff-gutter-bg': 'color-mix(in oklch, var(--card), var(--muted) 50%)' } as React.CSSProperties}
                >
                  {toolName === 'Edit' && <EditDiff params={input} />}
                  {toolName === 'Write' && <WriteDiff params={input} />}
                </div>
              )}
              {blockedPath && (
                <p className="break-all text-xs text-amber-600 dark:text-amber-400">{t('chat.permission.blockedPath', { path: blockedPath })}</p>
              )}
              {decisionReason && (
                <p className="text-xs text-muted-foreground">{decisionReason}</p>
              )}
              {isDebug && (
                <div className="space-y-1">
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
              </div>
              <div className="flex shrink-0 flex-col gap-2">
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
                    rejectRef={(el) => { btnRefs.current[hasAlwaysButton ? 2 : 1] = el }}
                    feedbackRef={feedbackRef}
                    onApprove={handleAllow}
                    onReject={handleDeny}
                    enterApproves={!defaultToNo}
                    // Two answers that differ only in lifetime read as the same word
                    // unless both say theirs. "Allow" next to "Always Allow" invites
                    // the user to assume the first one also sticks.
                    {...(isDeviceControlConfirm ? { approveLabel: t('chat.permission.allowForSession') } : {})}
                    {...(isScopedPermission ? { approveLabel: t(rememberPreview ? 'chat.permission.scoped.confirmRemember' : 'chat.permission.scoped.allowOnce'), rejectLabel: rememberPreview ? t('common.cancel') : undefined } : {})}
                    {...(rememberPreview ? { approveTone: 'primary', rejectTone: 'neutral' } as const : {})}
                    approveSuffix={(selectedSuggestions.size > 0 || rememberRule !== null) && (
                      <span className="ml-1 text-xs text-success-foreground/70">+{selectedSuggestions.size + (rememberRule ? 1 : 0)}</span>
                    )}
                    extraActions={hasAlwaysButton && (
                      <PermissionActionButton
                        ref={(el) => { btnRefs.current[1] = el }}
                        tone="primary"
                        kbd="⇧⏎"
                        onClick={handleAlwaysAllow}
                      >
                        {t(hasScopedAlways ? 'chat.permission.scoped.remember' : 'chat.permission.alwaysAllowDevice')}
                      </PermissionActionButton>
                    )}
                    feedback={rememberPreview ? undefined : {
                      value: feedback,
                      onChange: setFeedback,
                      focused: isFeedbackFocused,
                      onFocusChange: setIsFeedbackFocused,
                    }}
                  />
                )}
                {terminalRule && (
                  <TerminalRuleRows
                    terminalRule={terminalRule}
                    rememberRule={rememberRule}
                    onToggle={toggleRememberRule}
                  />
                )}
                {hasSuggestionRow && displaySuggestions && (
                  <PermissionSuggestionRows
                    suggestions={displaySuggestions}
                    selectedSuggestions={selectedSuggestions}
                    onToggle={toggleSuggestion}
                  />
                )}
              </div>
            </div>
          </div>
        )}
    </div>
  )
}

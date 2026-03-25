import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Circle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay } from './tool-display'
import { EditDiff, WriteDiff } from './ToolBlock'
import { modes as permissionModes } from './PermissionModeSelector'

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
            {mode.label}
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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const feedbackRef = useRef<HTMLInputElement>(null)

  const requestId = pendingPermission?.requestId
  const toolName = pendingPermission?.toolName
  const allowAlwaysAllow = pendingPermission?.allowAlwaysAllow
  const isCodexDecisionPrompt = sessionProvider === 'codex' && allowAlwaysAllow
  const isEditTool = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit'
  const suggestionsCount = pendingPermission?.suggestions?.length ?? 0

  useEffect(() => {
    setFeedback('')
    setFocusedIdx(0)
    setSelectedSuggestions(new Set())
    setIsFeedbackFocused(false)
  }, [requestId, suggestionsCount])

  useEffect(() => {
    if (requestId) {
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [requestId])

  const btnCount = isCodexDecisionPrompt ? 4 : 2

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
    if (selectedSuggestions.size > 0) {
      respondToPermission(requestId, true, undefined, undefined, [...selectedSuggestions])
    } else {
      respondToPermission(requestId, true)
    }
  }, [requestId, respondToPermission, selectedSuggestions])

  useEffect(() => {
    if (!requestId) return

    function onKeyDown(e: KeyboardEvent) {
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
  }, [requestId, btnCount, handleCancel, handleDeny, handleAcceptEdit, handleAllow, isCodexDecisionPrompt, isEditTool, suggestionsCount, toggleSuggestion])

  if (!pendingPermission) return null

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const display = getToolDisplay(toolName ?? '', input, cwd, homedir)
  const isBash = toolName === 'Bash'
  const isSandboxNetwork = toolName === 'SandboxNetworkAccess'
  const hasSuggestionRow = !isCodexDecisionPrompt && (allowAlwaysAllow || (suggestions && suggestions.length > 0))

  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => (toolName ?? '').toLowerCase().includes(n))

  let btnIdx = 0

  return (
    <div className="mx-3 mb-2 rounded-lg border border-border bg-muted/60 p-3">
      {isSandboxNetwork ? (
        <>
          <div className="mb-2 flex items-center gap-1.5 text-xs">
            <ShieldAlert className="size-3.5 shrink-0 text-amber-500" />
            <span className="font-medium text-amber-500">Allow Sandbox Network Access</span>
          </div>
          {typeof input.host === 'string' && input.host && (
            <p className="mb-2 font-mono text-xs text-muted-foreground">{input.host}</p>
          )}
        </>
      ) : (
        <>
          <div className="mb-2 flex items-center gap-1.5 text-xs">
            <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="font-medium text-foreground">{toolName}</span>
            {isBash && typeof input.description === 'string' && input.description && (
              <span className="min-w-0 truncate text-muted-foreground">{input.description}</span>
            )}
          </div>
          {isBash && !!input.dangerouslyDisableSandbox && (
            <div className="mb-2 flex items-start gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5">
              <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
              <span className="text-xs font-medium text-amber-500">Sandbox Override</span>
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
        <p className="mb-2 break-all text-xs text-amber-400">Blocked path: {blockedPath}</p>
      )}
      {decisionReason && (
        <p className="mb-2 text-xs text-muted-foreground">{decisionReason}</p>
      )}
      {isDebug && (
        <div className="mb-2 space-y-1">
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Input</div>
            <div className="max-h-32 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
              {JSON.stringify(input, null, 2)}
            </div>
          </div>
          {suggestions && suggestions.length > 0 && (
            <div>
              <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Suggestions</div>
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
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 focus:ring-2 focus:ring-green-400 focus:outline-none"
              onClick={handleAllow}
            >
              Allow
              <Kbd variant="inline" className="ml-1 text-green-200/80">⏎</Kbd>
            </Button>
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-blue-600 px-3 text-[11px] text-white hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
              onClick={handleAlwaysAllow}
            >
              Allow for this session
              <Kbd variant="inline" className="ml-1 text-blue-200/80">⇧↵</Kbd>
            </Button>
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-400 focus:outline-none"
              onClick={handleDeny}
            >
              Decline
              <Kbd variant="inline" className="ml-1 text-red-200/80">esc</Kbd>
            </Button>
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer border border-border bg-background/70 px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus:ring-2 focus:ring-slate-400 focus:outline-none"
              onClick={handleCancel}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 focus:ring-2 focus:ring-green-400 focus:outline-none"
              onClick={handleAllow}
            >
              Allow
              {selectedSuggestions.size > 0 && (
                <span className="ml-1 text-[10px] text-green-200/80">+{selectedSuggestions.size}</span>
              )}
              {!isFeedbackFocused && (
                <Kbd variant="inline" className="ml-1 text-green-200/80">⏎</Kbd>
              )}
            </Button>
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-400 focus:outline-none"
              onClick={handleDeny}
            >
              Deny
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
                placeholder="Deny reason (optional, Enter to submit)"
                className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <Kbd className="pointer-events-none absolute right-2">{isFeedbackFocused ? '↵' : '⇥'}</Kbd>
            </div>
          </div>
        )}
        {hasSuggestionRow && (
          <div className="grid grid-cols-1 gap-1.5">
            {allowAlwaysAllow && !isEditTool && (!suggestions || suggestions.length === 0) && (
              <Button
                size="sm"
                className="h-7 w-full cursor-pointer bg-blue-600 px-3 text-xs text-white hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
                onClick={handleAlwaysAllow}
              >
                Always Allow
              </Button>
            )}
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
                    ? <CheckCircle2 className="size-3.5 shrink-0 text-green-400" />
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
  )
}

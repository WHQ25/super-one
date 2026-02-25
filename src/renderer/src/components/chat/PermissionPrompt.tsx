import { useRef, useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { CommandShortcut } from '@/components/ui/command'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { Circle, CheckCircle2 } from 'lucide-react'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay } from './tool-display'
import { modes as permissionModes } from './PermissionModeSelector'

/** Dev-only: comma-separated tool names to show debug data in permission prompt. */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

const DEST_LABELS: Record<string, string> = {
  session: 'session',
  localSettings: 'folder',
  projectSettings: 'project',
  userSettings: 'user',
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
  const pendingPermission = useActiveSession((s) => s.pendingPermission)
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
  const isEditTool = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit'
  const suggestionsCount = pendingPermission?.suggestions?.length ?? 0

  // Reset state when a new permission request comes in
  useEffect(() => {
    setFeedback('')
    setFocusedIdx(0)
    setSelectedSuggestions(new Set())
  }, [requestId, suggestionsCount])

  // Auto-focus first button when prompt appears
  useEffect(() => {
    if (requestId) {
      // Small delay to ensure refs are populated after render
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [requestId])

  // Number of action buttons
  const btnCount = 2

  const handleDeny = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, false, undefined, feedback.trim() || undefined)
  }, [requestId, respondToPermission, feedback])

  const handleAcceptEdit = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true)
    setPermissionMode('acceptEdits')
  }, [requestId, respondToPermission, setPermissionMode])

  const handleAlwaysAllow = useCallback(() => {
    if (!requestId) return
    respondToPermission(requestId, true, true)
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

  // Keyboard navigation
  useEffect(() => {
    if (!requestId) return

    function onKeyDown(e: KeyboardEvent) {
      // Shift+Tab on Write/Edit tools → Accept Edit (always)
      if (e.key === 'Tab' && e.shiftKey && isEditTool) {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleAcceptEdit()
        return
      }

      // When feedback is focused: Enter → deny with reason, Escape → blur
      if (document.activeElement === feedbackRef.current) {
        if (e.key === 'Enter' && !e.isComposing) {
          e.preventDefault()
          handleDeny()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          feedbackRef.current?.blur()
        }
        return
      }

      // Enter → allow (with selected suggestions)
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault()
        handleAllow()
        return
      }

      // Escape → deny
      if (e.key === 'Escape') {
        e.preventDefault()
        handleDeny()
        return
      }

      // Number keys 1-9 to toggle suggestion selection
      if (e.key >= '1' && e.key <= '9') {
        const idx = parseInt(e.key) - 1
        if (idx < suggestionsCount) {
          e.preventDefault()
          toggleSuggestion(idx)
        }
        return
      }

      // Arrow left/right to navigate between buttons
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

      // Tab → focus feedback input
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestId, btnCount, handleDeny, handleAcceptEdit, handleAllow, isEditTool, suggestionsCount, toggleSuggestion])

  if (!pendingPermission) return null

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const display = getToolDisplay(toolName ?? '', input, cwd, homedir)
  const isBash = toolName === 'Bash'
  const hasSuggestionRow = allowAlwaysAllow || (suggestions && suggestions.length > 0)

  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => (toolName ?? '').toLowerCase().includes(n))

  let btnIdx = 0

  return (
    <div className="mx-3 mb-2 rounded-lg border border-border bg-muted/60 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs">
        <ToolIcon icon={display.icon} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium text-foreground">{toolName}</span>
      </div>
      {display.summary && (
        <p
          className={`mb-2 text-xs text-muted-foreground ${isBash ? 'whitespace-pre-wrap break-all font-mono' : 'truncate'}`}
        >
          {display.summary}
        </p>
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
              <CommandShortcut className="ml-1 text-[10px] text-green-200/80">⏎</CommandShortcut>
            )}
          </Button>
          <Button
            ref={(el) => { btnRefs.current[btnIdx++] = el }}
            size="sm"
            className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-400 focus:outline-none"
            onClick={handleDeny}
          >
            Deny
            {!isFeedbackFocused && (
              <CommandShortcut className="ml-1 text-[10px] text-red-200/80">Esc</CommandShortcut>
            )}
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
            <CommandShortcut className="pointer-events-none absolute right-2 rounded bg-background/60 px-1 py-0.5 text-[10px] text-muted-foreground">⇥</CommandShortcut>
          </div>
        </div>
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
                  <CommandShortcut className="ml-auto inline-flex size-4 shrink-0 items-center justify-center rounded bg-background/60 text-[10px] text-muted-foreground">{i + 1}</CommandShortcut>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

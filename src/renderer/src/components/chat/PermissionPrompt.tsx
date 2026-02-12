import { useRef, useState, useEffect, useCallback, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { CommandShortcut } from '@/components/ui/command'
import { useChatStore, useActiveSession } from '@/stores/chat'
import { ToolIcon } from './ToolIcon'
import { getToolDisplay } from './tool-display'

/** Dev-only: comma-separated tool names to show debug data in permission prompt. */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

/** Turn a raw suggestion object into a human-readable label + destination tag. */
function formatSuggestion(s: Record<string, unknown>): { label: string; destination: string } {
  const type = s.type as string | undefined
  const destination = (s.destination as string) ?? 'session'
  const rules = s.rules as Array<{ toolName?: string; ruleContent?: string }> | undefined
  const directories = s.directories as string[] | undefined

  const formatRules = () =>
    rules?.map((r) => [r.toolName, r.ruleContent].filter(Boolean).join(': ')).join(', ') ?? ''

  switch (type) {
    case 'addRules': return { label: `Allow ${formatRules()}`, destination }
    case 'replaceRules': return { label: `Replace ${formatRules()}`, destination }
    case 'removeRules': return { label: `Remove ${formatRules()}`, destination }
    case 'setMode': return { label: `Switch to ${s.mode} mode`, destination }
    case 'addDirectories': return { label: `Add directory: ${directories?.join(', ')}`, destination }
    case 'removeDirectories': return { label: `Remove directory: ${directories?.join(', ')}`, destination }
    default: return { label: JSON.stringify(s), destination }
  }
}

/** Derive a smart button label from the primary suggestion type. */
function getAlwaysAllowLabel(suggestions?: Array<Record<string, unknown>>): string {
  const primary = suggestions?.[0]?.type as string | undefined
  switch (primary) {
    case 'addRules': return 'Allow Similar'
    case 'setMode': return 'Switch Mode'
    case 'addDirectories': return 'Add Directory'
    default: return 'Always Allow'
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
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([])
  const feedbackRef = useRef<HTMLInputElement>(null)

  const requestId = pendingPermission?.requestId
  const toolName = pendingPermission?.toolName
  const allowAlwaysAllow = pendingPermission?.allowAlwaysAllow
  const isEditTool = toolName === 'Write' || toolName === 'Edit' || toolName === 'NotebookEdit'

  // Reset state when a new permission request comes in
  useEffect(() => {
    setFeedback('')
    setFocusedIdx(0)
  }, [requestId])

  // Auto-focus first button when prompt appears
  useEffect(() => {
    if (requestId) {
      // Small delay to ensure refs are populated after render
      requestAnimationFrame(() => btnRefs.current[0]?.focus())
    }
  }, [requestId])

  // Number of action buttons
  const btnCount = useMemo(() => (allowAlwaysAllow ? 3 : 2), [allowAlwaysAllow])

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

  // Keyboard navigation: arrows move between buttons, Tab goes to feedback, Shift+Tab for Accept Edit
  useEffect(() => {
    if (!requestId) return

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement

      // Escape → deny immediately
      if (e.key === 'Escape') {
        e.preventDefault()
        handleDeny()
        return
      }

      // Shift+Tab on Write/Edit tools → Accept Edit
      if (e.key === 'Tab' && e.shiftKey && isEditTool) {
        e.preventDefault()
        e.stopImmediatePropagation()
        handleAcceptEdit()
        return
      }

      // If focused on feedback input, only handle Enter (submit)
      if (active === feedbackRef.current) {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleDeny()
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

      // Tab (without Shift) to focus feedback input
      if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault()
        feedbackRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [requestId, btnCount, handleDeny, handleAcceptEdit, isEditTool])

  if (!pendingPermission) return null

  const { input, decisionReason, blockedPath, suggestions } = pendingPermission
  const display = getToolDisplay(toolName ?? '', input, cwd, homedir)
  const isBash = toolName === 'Bash'

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
      {suggestions && suggestions.length > 0 && (
        <div className="mb-2 space-y-0.5">
          {suggestions.map((s, i) => {
            const { label, destination } = formatSuggestion(s)
            return (
              <div key={i} className="flex items-center gap-1.5 text-[11px]">
                <span className="text-muted-foreground">{label}</span>
                <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground/60">{destination}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          ref={(el) => { btnRefs.current[btnIdx++] = el }}
          size="sm"
          className="h-7 cursor-pointer bg-green-700 px-3 text-xs text-white hover:bg-green-600 focus:ring-2 focus:ring-green-400 focus:outline-none"
          onClick={() => respondToPermission(requestId!, true)}
        >
          Allow
        </Button>
        {allowAlwaysAllow && (
          isEditTool ? (
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-purple-600 px-3 text-xs text-white hover:bg-purple-500 focus:ring-2 focus:ring-purple-400 focus:outline-none"
              onClick={handleAcceptEdit}
            >
              Accept Edit
              <CommandShortcut className="ml-1 text-[10px] text-purple-200/80">⇧⇥</CommandShortcut>
            </Button>
          ) : (
            <Button
              ref={(el) => { btnRefs.current[btnIdx++] = el }}
              size="sm"
              className="h-7 cursor-pointer bg-blue-600 px-3 text-xs text-white hover:bg-blue-500 focus:ring-2 focus:ring-blue-400 focus:outline-none"
              onClick={handleAlwaysAllow}
            >
              {getAlwaysAllowLabel(suggestions)}
            </Button>
          )
        )}
        <Button
          ref={(el) => { btnRefs.current[btnIdx++] = el }}
          size="sm"
          className="h-7 cursor-pointer bg-red-700 px-3 text-xs text-white hover:bg-red-600 focus:ring-2 focus:ring-red-400 focus:outline-none"
          onClick={handleDeny}
        >
          Deny
          <CommandShortcut className="ml-1 text-[10px] text-red-200/80">Esc</CommandShortcut>
        </Button>
        <div className="relative flex flex-1 items-center">
          <input
            ref={feedbackRef}
            data-feedback
            type="text"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Deny reason (optional, Enter to submit)"
            className="h-7 w-full rounded bg-muted px-2 pr-12 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <CommandShortcut className="pointer-events-none absolute right-2 rounded bg-background/60 px-1 py-0.5 text-[10px] text-muted-foreground">⇥</CommandShortcut>
        </div>
      </div>
    </div>
  )
}

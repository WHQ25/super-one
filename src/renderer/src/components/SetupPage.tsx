import { useState, useEffect, useRef, useMemo } from 'react'
import { Download, CheckCircle, XCircle, ArrowRight, Loader2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { useShallow } from 'zustand/react/shallow'
import type { SetupEvent } from '../../../shared/agent-types'

// ANSI 16-color map → Tailwind classes
const ANSI_COLOR_MAP: Record<number, string> = {
  30: 'text-zinc-900', 31: 'text-red-400', 32: 'text-green-400', 33: 'text-yellow-400',
  34: 'text-blue-400', 35: 'text-purple-400', 36: 'text-cyan-400', 37: 'text-zinc-300',
  90: 'text-zinc-500', 91: 'text-red-300', 92: 'text-green-300', 93: 'text-yellow-300',
  94: 'text-blue-300', 95: 'text-purple-300', 96: 'text-cyan-300', 97: 'text-white',
}

interface AnsiSpan { text: string; className: string }

/** Parse ANSI escape sequences into colored spans */
function parseAnsi(raw: string): AnsiSpan[] {
  const spans: AnsiSpan[] = []
  const re = /\x1b\[([0-9;]*)m/g
  let currentClass = 'text-zinc-300'
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      spans.push({ text: raw.slice(lastIndex, match.index), className: currentClass })
    }
    const codes = match[1].split(';').map(Number)
    for (const code of codes) {
      if (code === 0 || code === 39) {
        currentClass = 'text-zinc-300'
      } else if (code === 1) {
        currentClass += ' font-bold'
      } else if (ANSI_COLOR_MAP[code]) {
        currentClass = ANSI_COLOR_MAP[code]
      }
    }
    lastIndex = re.lastIndex
  }

  if (lastIndex < raw.length) {
    spans.push({ text: raw.slice(lastIndex), className: currentClass })
  }
  return spans
}

function TerminalOutput({ text }: { text: string }): React.JSX.Element {
  const lines = useMemo(() => text.split('\n'), [text])

  return (
    <>
      {lines.map((line, i) => (
        <div key={i}>
          {line ? (
            parseAnsi(line).map((span, j) => (
              <span key={j} className={span.className}>{span.text}</span>
            ))
          ) : (
            '\u00A0'
          )}
        </div>
      ))}
    </>
  )
}

export function SetupPage(): React.JSX.Element {
  const { installStatus, installOutput, startInstall, handleSetupEvent, continueToMain } = useAppStore(useShallow((s) => ({ installStatus: s.installStatus, installOutput: s.installOutput, startInstall: s.startInstall, handleSetupEvent: s.handleSetupEvent, continueToMain: s.continueToMain })))
  const outputRef = useRef<HTMLDivElement>(null)
  const [checking, setChecking] = useState(true)

  // Auto-detect Claude on mount
  useEffect(() => {
    let ignore = false
    window.app.checkClaude().then((hasClaude) => {
      if (ignore) return
      if (hasClaude) {
        continueToMain()
      } else {
        setChecking(false)
      }
    })
    return () => { ignore = true }
  }, [continueToMain])

  useEffect(() => {
    const cleanup = window.app.onSetupEvent((event: SetupEvent) => {
      handleSetupEvent(event)
    })
    return cleanup
  }, [handleSetupEvent])

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight
    }
  }, [installOutput])

  const isInstalling = installStatus === 'installing'

  if (checking) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
      {/* Header — changes based on status */}
      <div className="text-center">
        {installStatus === 'idle' && (
          <>
            <h1 className="text-2xl font-bold">Setup Required</h1>
            <p className="mt-2 text-muted-foreground">
              Claude Code is required to power this app. Install it to continue.
            </p>
          </>
        )}
        {isInstalling && (
          <>
            <div className="flex items-center justify-center gap-2">
              <Loader2 className="size-5 animate-spin text-primary" />
              <h1 className="text-2xl font-bold">Installing Claude Code...</h1>
            </div>
            <p className="mt-2 text-muted-foreground">
              This may take a minute or two. Please don't close the app.
            </p>
          </>
        )}
        {installStatus === 'success' && (
          <>
            <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="size-5" />
              <h1 className="text-2xl font-bold">Installation Complete</h1>
            </div>
            <p className="mt-2 text-muted-foreground">Claude Code is ready to use.</p>
          </>
        )}
        {installStatus === 'error' && (
          <>
            <div className="flex items-center justify-center gap-2 text-red-600 dark:text-red-400">
              <XCircle className="size-5" />
              <h1 className="text-2xl font-bold">Installation Failed</h1>
            </div>
            <p className="mt-2 text-muted-foreground">
              Something went wrong. Check the output below and try again.
            </p>
          </>
        )}
      </div>

      {/* Action buttons */}
      {installStatus === 'idle' && (
        <Button size="lg" onClick={startInstall}>
          <Download className="size-5" />
          Install Claude Code
        </Button>
      )}
      {installStatus === 'success' && (
        <Button size="lg" onClick={continueToMain}>
          Continue
          <ArrowRight className="size-5" />
        </Button>
      )}
      {installStatus === 'error' && (
        <Button size="lg" variant="outline" onClick={startInstall}>
          Retry
        </Button>
      )}

      {/* Faux terminal */}
      {(isInstalling || installOutput) && (
        <div className="w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-700 bg-zinc-950 shadow-lg dark:border-zinc-600">
          {/* Title bar */}
          <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900 px-4 py-2">
            <div className="flex gap-1.5">
              <span className="size-3 rounded-full bg-red-500" />
              <span className="size-3 rounded-full bg-yellow-500" />
              <span className="size-3 rounded-full bg-green-500" />
            </div>
            <div className="flex flex-1 items-center justify-center gap-1.5 text-xs text-zinc-400">
              <Terminal className="size-3" />
              <span>Terminal</span>
            </div>
            <div className="w-[42px]" />
          </div>
          {/* Output */}
          <div
            ref={outputRef}
            className="overflow-auto p-4 font-mono text-xs leading-relaxed"
            style={{ maxHeight: '280px' }}
          >
            <TerminalOutput text={installOutput} />
            {isInstalling && (
              <span className="inline-block h-4 w-1.5 animate-pulse bg-zinc-400" />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

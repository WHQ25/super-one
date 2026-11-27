import { useEffect, useRef } from 'react'
import type { Terminal as XTerm } from '@xterm/xterm'
import { cn } from '@superone/ui/lib/utils'
import { createBaseXterm } from './term-instance'
import {
  getTerminalFontFamily,
  getTerminalFontSize,
  getTerminalTheme,
  onTerminalThemeChange,
} from './terminal-theme'

const ANSI_ESCAPE_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

function stripAnsiEscapes(text: string): string {
  return text.replace(ANSI_ESCAPE_RE, '')
}

function canMountXterm(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
}

export function ReadOnlyTerminal({
  output,
  className,
  testId,
}: {
  output: string
  className?: string
  testId?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const writtenRef = useRef('')
  const latestOutputRef = useRef(output)
  latestOutputRef.current = output

  useEffect(() => {
    const host = hostRef.current
    if (!host || !canMountXterm()) return

    let xterm: XTerm | null = null
    let stopTheme: (() => void) | undefined
    let ro: ResizeObserver | undefined
    let raf = 0

    try {
      const created = createBaseXterm({
        disableStdin: true,
        convertEol: true,
        cursorBlink: false,
        cursorInactiveStyle: 'none',
        scrollback: 1000,
      })
      xterm = created.xterm
      const { fit } = created
      xterm.open(host)
      xtermRef.current = xterm
      writtenRef.current = ''

      const fitSafely = () => {
        if (!xterm?.element?.isConnected) return
        if (host.clientWidth === 0 || host.clientHeight === 0) return
        try {
          fit.fit()
        } catch {
          return
        }
      }

      fitSafely()
      raf = requestAnimationFrame(fitSafely)

      const initial = latestOutputRef.current
      if (initial) {
        xterm.write(initial)
        writtenRef.current = initial
      }

      stopTheme = onTerminalThemeChange(() => {
        if (!xterm) return
        const fontSize = getTerminalFontSize()
        const fontFamily = getTerminalFontFamily()
        const metricsChanged =
          xterm.options.fontSize !== fontSize || xterm.options.fontFamily !== fontFamily
        xterm.options.theme = getTerminalTheme()
        if (metricsChanged) {
          xterm.options.fontSize = fontSize
          xterm.options.fontFamily = fontFamily
        }
        xterm.clearTextureAtlas()
        if (metricsChanged) fitSafely()
      })

      if (typeof ResizeObserver !== 'undefined') {
        ro = new ResizeObserver(fitSafely)
        ro.observe(host)
      }
    } catch {
      xterm?.dispose()
      xterm = null
      xtermRef.current = null
    }

    return () => {
      cancelAnimationFrame(raf)
      ro?.disconnect()
      stopTheme?.()
      xterm?.dispose()
      xtermRef.current = null
      writtenRef.current = ''
    }
  }, [])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    const written = writtenRef.current
    if (output === written) return
    if (written.length > 0 && output.startsWith(written)) {
      xterm.write(output.slice(written.length))
    } else {
      xterm.reset()
      if (output) xterm.write(output)
    }
    writtenRef.current = output
  }, [output])

  return (
    <div data-testid={testId} className={cn('relative overflow-hidden p-2', className)}>
      <div ref={hostRef} className="h-full w-full overflow-hidden" />
      {output ? <pre className="sr-only">{stripAnsiEscapes(output)}</pre> : null}
    </div>
  )
}

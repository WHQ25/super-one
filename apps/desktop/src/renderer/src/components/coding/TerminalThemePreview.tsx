import { useEffect, useMemo, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import type { AnsiColors, TerminalScheme } from './terminal-palettes'

const SURFACES: Record<TerminalScheme, Pick<ITheme, 'background' | 'foreground' | 'cursor' | 'selectionBackground'>> = {
  light: { background: '#faf9f7', foreground: '#2a2723', cursor: '#c05a2b', selectionBackground: '#e9c9b3' },
  dark: { background: '#262626', foreground: '#e6e6e6', cursor: '#d98a3d', selectionBackground: '#4a3f34' },
}

function buildSample(): string {
  return [
    `\x1b[1;32m➜\x1b[0m  \x1b[1;36msuper-one\x1b[0m \x1b[1;34mgit:(\x1b[31mmain\x1b[1;34m)\x1b[0m ls`,
    `\x1b[1;34mapps\x1b[0m  \x1b[1;34mpackages\x1b[0m  README.md  \x1b[33mpackage.json\x1b[0m`,
    `\x1b[32m✓ build ok\x1b[0m  \x1b[33m⚠ 2 warnings\x1b[0m  \x1b[31m✗ 1 error\x1b[0m`,
    `\x1b[36mINFO\x1b[0m ready  \x1b[35mDEBUG\x1b[0m cache hit  \x1b[90mtrace…done\x1b[0m`,
  ].join('\r\n')
}

const DEFAULT_MONO = 'Monaco, ui-monospace, SFMono-Regular, Menlo, monospace'

export function TerminalThemePreview({
  ansi,
  scheme,
  fontSize,
  fontFamily,
}: {
  ansi: AnsiColors
  scheme: TerminalScheme
  fontSize: number
  fontFamily?: string | null
}) {
  const resolvedFont = fontFamily ? `"${fontFamily}", ${DEFAULT_MONO}` : DEFAULT_MONO
  const hostRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)

  const theme = useMemo<ITheme>(() => {
    const surface = SURFACES[scheme]
    return { ...surface, cursorAccent: surface.background, ...ansi }
  }, [ansi, scheme])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const xterm = new XTerm({
      fontSize,
      fontFamily: resolvedFont,
      cols: 52,
      rows: 4,
      cursorBlink: false,
      disableStdin: true,
      scrollback: 0,
      theme,
    })
    xterm.open(host)
    xterm.write(buildSample())
    xtermRef.current = xterm
    return () => {
      xterm.dispose()
      xtermRef.current = null
    }
  }, [])

  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    xterm.options.theme = theme
    if (xterm.options.fontSize !== fontSize) xterm.options.fontSize = fontSize
    if (xterm.options.fontFamily !== resolvedFont) xterm.options.fontFamily = resolvedFont
    xterm.refresh(0, xterm.rows - 1)
  }, [theme, fontSize, resolvedFont])

  return (
    <div
      ref={hostRef}
      className="overflow-hidden rounded-md p-2"
      style={{ backgroundColor: theme.background }}
    />
  )
}

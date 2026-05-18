import { useEffect, useState } from 'react'
import { Palette } from 'lucide-react'
import type { SectionDef } from '../components/Section'
import { Out } from '../components/kit'

const SWATCHES = [
  '--background',
  '--foreground',
  '--primary',
  '--accent',
  '--border',
  '--destructive',
]

function Demo() {
  const [isDark, setIsDark] = useState(window.superone.isDarkMode())
  const [vars, setVars] = useState<Record<string, string>>(
    window.superone.theme.getVars(),
  )

  useEffect(() => {
    const offDark = window.superone.onDarkModeChange(setIsDark)
    const offVars = window.superone.theme.onChange(setVars)
    return () => {
      offDark()
      offVars()
    }
  }, [])

  return (
    <div>
      <div className="text-[13px] mb-3">
        Mode:{' '}
        <span className="font-semibold">{isDark ? '🌙 dark' : '☀️ light'}</span>{' '}
        — toggle the host theme; this updates live.
      </div>
      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((name) => (
          <div key={name} className="flex flex-col items-center gap-1">
            <div
              className="w-12 h-12 rounded-md border border-border"
              style={{ background: `var(${name})` }}
            />
            <code className="text-[10px] text-muted-fg">{name}</code>
          </div>
        ))}
      </div>
      <Out>radius: {vars.radius ?? vars['--radius'] ?? 'n/a'}</Out>
    </div>
  )
}

const react = `import { useEffect, useState } from 'react'

function ThemeAware() {
  const [dark, setDark] = useState(window.superone.isDarkMode())
  const [vars, setVars] = useState(window.superone.theme.getVars())

  useEffect(() => {
    const offDark = window.superone.onDarkModeChange(setDark)
    const offVars = window.superone.theme.onChange(setVars)
    return () => {
      offDark()
      offVars()
    }
  }, [])

  // Prefer CSS vars over JS; read getVars() only when you must
  return <div style={{ background: 'var(--card)' }}>{dark ? '🌙' : '☀️'}</div>
}`

const vanilla = `// The host injects design tokens as CSS variables on :root and
// flips them on light/dark — prefer CSS over JS:
//   body { background: var(--background); color: var(--foreground); }

const vars = superone.theme.getVars()      // { primary: 'oklch(...)', ... }
const dark = superone.isDarkMode()         // boolean

superone.theme.onChange((v) => { /* tokens changed */ })
superone.onDarkModeChange((isDark) => {
  chart.options.color = isDark ? '#fff' : '#000'
  chart.update()
})`

export const themeSection: SectionDef = {
  id: 'theme',
  icon: Palette,
  title: 'Theme & Dark Mode',
  api: 'superone.theme',
  blurb:
    'Host design tokens are injected as CSS variables and flip on light/dark — read them via theme.getVars() / isDarkMode().',
  Demo,
  react,
  vanilla,
}

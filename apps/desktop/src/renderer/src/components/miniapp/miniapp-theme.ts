const THEME_VARS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'ring',
  'radius',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
]

export type ThemeVars = Record<string, string>

export function readThemeVars(): ThemeVars {
  const style = getComputedStyle(document.documentElement)
  const vars: ThemeVars = {}
  for (const name of THEME_VARS) {
    const value = style.getPropertyValue(`--${name}`).trim()
    if (value) vars[name] = value
  }
  return vars
}

export function onThemeChange(callback: () => void): () => void {
  let raf: number | null = null
  const observer = new MutationObserver(() => {
    if (raf !== null) return
    raf = requestAnimationFrame(() => {
      raf = null
      callback()
    })
  })
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  return () => {
    observer.disconnect()
    if (raf !== null) cancelAnimationFrame(raf)
  }
}

import { useEffect, useState } from 'react'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import type { HarnessId } from '../../../shared/session-types'
import { brandHueToOklch, HARNESS_DEFAULT_BRAND_HUE } from '../../../shared/harness-brand'

function readDarkClass(): boolean {
  return document.documentElement.classList.contains('dark')
}

function useDarkClass(): boolean {
  const [dark, setDark] = useState<boolean>(readDarkClass)
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(readDarkClass()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function useActiveHarness(): HarnessId {
  return useActiveSession((s) => {
    const provider = s.sessionProvider ?? s.preferredProvider
    return provider === 'codex' ? 'codex' : 'claude'
  })
}

const SURFACE_RECIPE: Array<{ token: string; l: number; c: number }> = [
  { token: '--background', l: 0.99, c: 0.005 },
  { token: '--card', l: 1, c: 0.003 },
  { token: '--popover', l: 1, c: 0.003 },
  { token: '--secondary', l: 0.96, c: 0.012 },
  { token: '--muted', l: 0.96, c: 0.01 },
  { token: '--accent', l: 0.93, c: 0.03 },
  { token: '--border', l: 0.91, c: 0.012 },
  { token: '--input', l: 0.91, c: 0.012 },
  { token: '--sidebar', l: 0.97, c: 0.01 },
  { token: '--sidebar-accent', l: 0.93, c: 0.02 },
  { token: '--sidebar-border', l: 0.89, c: 0.015 },
]

const ACCENT_TOKENS = ['--primary', '--ring', '--sidebar-primary', '--sidebar-ring'] as const

export function useHarnessTheme(): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const claudeHue = useAppStore((s) => s.brandHues.claude)
  const codexHue = useAppStore((s) => s.brandHues.codex)

  useEffect(() => {
    const defaultHue = HARNESS_DEFAULT_BRAND_HUE[harness]
    const userHue = harness === 'codex' ? codexHue : claudeHue
    const effective = dark ? defaultHue : (userHue ?? defaultHue)
    const accentOklch = brandHueToOklch(effective)

    const root = document.documentElement
    root.style.setProperty('--harness-primary', accentOklch)
    root.dataset.harness = harness

    if (dark) {
      for (const token of ACCENT_TOKENS) root.style.removeProperty(token)
      for (const { token } of SURFACE_RECIPE) root.style.removeProperty(token)
      return
    }

    for (const token of ACCENT_TOKENS) root.style.setProperty(token, accentOklch)
    for (const { token, l, c } of SURFACE_RECIPE) {
      root.style.setProperty(token, `oklch(${l} ${c} ${effective})`)
    }
  }, [harness, dark, claudeHue, codexHue])
}

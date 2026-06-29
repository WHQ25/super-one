import { useEffect, useRef, useState, type RefObject } from 'react'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import type { HarnessId } from '@superone/shared/session-types'
import {
  DESIGN_TOKENS,
  HARNESS_DEFAULT_BRAND_HUE,
  LCH_CHANNELS,
  type LCHChannel,
  type LCHPartial,
  type TokenOverrides,
} from '@superone/shared/harness-brand'

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

interface AppliedSnapshot {
  brandHue: number | null
  overrides: TokenOverrides
  dark: boolean
}

const EMPTY_SNAPSHOT: AppliedSnapshot = { brandHue: null, overrides: {}, dark: false }

function syncBrandProps(
  el: HTMLElement,
  hue: number | null,
  overrides: TokenOverrides,
  dark: boolean,
  prev: AppliedSnapshot,
): AppliedSnapshot {
  if (dark) {
    if (!prev.dark) {
      el.style.removeProperty('--brand-hue')
      for (const token of DESIGN_TOKENS) {
        for (const ch of LCH_CHANNELS) {
          el.style.removeProperty(`${token}-${ch}`)
        }
      }
    }
    return { brandHue: null, overrides: {}, dark: true }
  }

  const prevBrandHue = prev.dark ? null : prev.brandHue
  const prevOv = prev.dark ? {} : prev.overrides

  if (hue !== prevBrandHue) {
    if (hue !== null) {
      el.style.setProperty('--brand-hue', String(hue))
    } else {
      el.style.removeProperty('--brand-hue')
    }
  }

  const allTokens = new Set([...Object.keys(prevOv), ...Object.keys(overrides)])
  for (const tokenKey of allTokens) {
    const cur = overrides[tokenKey as keyof TokenOverrides] as LCHPartial | undefined
    const prv = prevOv[tokenKey as keyof TokenOverrides] as LCHPartial | undefined
    for (const ch of LCH_CHANNELS) {
      const newVal = cur?.[ch]
      const oldVal = prv?.[ch]
      if (newVal === oldVal) continue
      if (newVal !== undefined) {
        el.style.setProperty(`${tokenKey}-${ch}`, String(newVal))
      } else {
        el.style.removeProperty(`${tokenKey}-${ch}`)
      }
    }
  }

  return { brandHue: hue, overrides, dark: false }
}

export function usePaneHarnessTheme(ref: RefObject<HTMLElement | null>): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const claudeHue = useAppStore((s) => s.brandHues.claude)
  const codexHue = useAppStore((s) => s.brandHues.codex)
  const claudeOverrides = useAppStore((s) => s.tokenOverrides.claude)
  const codexOverrides = useAppStore((s) => s.tokenOverrides.codex)

  const appliedRef = useRef<AppliedSnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rawHue = harness === 'codex' ? codexHue : claudeHue
    const userHue = rawHue ?? HARNESS_DEFAULT_BRAND_HUE[harness]
    const overrides = harness === 'codex' ? codexOverrides : claudeOverrides
    el.dataset.harness = harness
    el.classList.toggle('brand-scope', !dark)
    let raf: number | null = requestAnimationFrame(() => {
      raf = null
      appliedRef.current = syncBrandProps(el, userHue, overrides, dark, appliedRef.current)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [ref, harness, dark, claudeHue, codexHue, claudeOverrides, codexOverrides])
}

export function useHarnessTheme(): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const claudeHue = useAppStore((s) => s.brandHues.claude)
  const codexHue = useAppStore((s) => s.brandHues.codex)
  const claudeOverrides = useAppStore((s) => s.tokenOverrides.claude)
  const codexOverrides = useAppStore((s) => s.tokenOverrides.codex)
  const terminalLightPalette = useAppStore((s) => s.terminalLightPalette)
  const terminalDarkPalette = useAppStore((s) => s.terminalDarkPalette)
  const terminalFontSize = useAppStore((s) => s.terminalFontSize)
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const liquidGlass = useAppStore((s) => s.liquidGlass)

  const appliedRef = useRef<AppliedSnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    const userHue = harness === 'codex' ? codexHue : claudeHue
    const overrides = harness === 'codex' ? codexOverrides : claudeOverrides
    const root = document.documentElement
    root.dataset.harness = harness
    root.classList.toggle('liquid-glass', liquidGlass)
    if (terminalLightPalette) root.dataset.terminalPaletteLight = terminalLightPalette
    else delete root.dataset.terminalPaletteLight
    if (terminalDarkPalette) root.dataset.terminalPaletteDark = terminalDarkPalette
    else delete root.dataset.terminalPaletteDark
    root.dataset.terminalFontSize = String(terminalFontSize)
    if (terminalFontFamily) root.dataset.terminalFontFamily = terminalFontFamily
    else delete root.dataset.terminalFontFamily
    if (uiFontFamily) {
      root.style.setProperty('--app-font-sans', `"${uiFontFamily}", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`)
    } else {
      root.style.removeProperty('--app-font-sans')
    }

    let raf: number | null = requestAnimationFrame(() => {
      raf = null
      appliedRef.current = syncBrandProps(root, userHue, overrides, dark, appliedRef.current)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [harness, dark, claudeHue, codexHue, claudeOverrides, codexOverrides, terminalLightPalette, terminalDarkPalette, terminalFontSize, terminalFontFamily, uiFontFamily, liquidGlass])
}

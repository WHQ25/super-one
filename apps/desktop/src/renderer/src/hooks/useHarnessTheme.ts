import { useEffect, useRef, useState, type RefObject } from 'react'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import type { HarnessId } from '@superone/shared/session-types'
import {
  DESIGN_TOKENS,
  HARNESS_DEFAULT_BRAND_HUE,
  LCH_CHANNELS,
  inkForFill,
  resolveTokenLCH,
  type DesignToken,
  type LCH,
  type LCHChannel,
  type TokenOverrides,
} from '@superone/shared/harness-brand'
import { shouldApplyLiquidGlassClass } from '@/lib/liquid-glass-platform'

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
  return useActiveSession((s) => s.sessionProvider ?? s.preferredProvider ?? 'claude')
}

/** Fills whose readable ink is derived, not authored. Value = the ink's token. */
const DERIVED_INK: ReadonlyArray<readonly [DesignToken, string]> = [
  ['--primary', '--primary-foreground'],
  ['--sidebar-primary', '--sidebar-primary-foreground'],
]

interface AppliedSnapshot {
  /** Every custom property this element currently owns, keyed by property name. */
  props: Map<string, string>
}

const EMPTY_SNAPSHOT: AppliedSnapshot = { props: new Map() }

/**
 * The light palette this element should render, as flat custom properties.
 *
 * Every token is stamped, not just the ones the user overrode. The CSS fallbacks
 * in `theme.css` cannot express `maxChromaInSRGB(l, hue)` — they have to pick one
 * constant chroma, which silently clips on narrow hues and leaves wide ones (like
 * claude's orange) visibly washed out. Resolving here is what actually delivers
 * per-hue chroma to the DOM, and it makes `theme.css` and `buildHarnessDefaults`
 * agree by construction rather than by two hand-maintained copies.
 */
function lightPaletteProps(harness: HarnessId, hue: number | null, overrides: TokenOverrides): Map<string, string> {
  const props = new Map<string, string>()
  if (hue !== null) props.set('--brand-hue', String(hue))

  const resolved = {} as Record<DesignToken, LCH>
  for (const token of DESIGN_TOKENS) {
    const lch = resolveTokenLCH(harness, token, overrides[token], hue)
    resolved[token] = lch
    for (const ch of LCH_CHANNELS) props.set(`${token}-${ch}`, String(lch[ch]))
  }
  for (const [fill, ink] of DERIVED_INK) {
    const lch = inkForFill(resolved[fill])
    props.set(ink, `oklch(${lch.l} ${lch.c} ${lch.h})`)
  }
  return props
}

function syncBrandProps(
  el: HTMLElement,
  harness: HarnessId,
  hue: number | null,
  overrides: TokenOverrides,
  dark: boolean,
  prev: AppliedSnapshot,
): AppliedSnapshot {
  // Dark mode is hue-agnostic and fully authored in `.dark`, so every inline
  // property has to go — an inline value would outrank the class rule.
  const next = dark ? new Map<string, string>() : lightPaletteProps(harness, hue, overrides)

  for (const name of prev.props.keys()) {
    if (!next.has(name)) el.style.removeProperty(name)
  }
  for (const [name, value] of next) {
    if (prev.props.get(name) !== value) el.style.setProperty(name, value)
  }
  return { props: next }
}

export function usePaneHarnessTheme(ref: RefObject<HTMLElement | null>): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const brandHue = useAppStore((s) => s.brandHues[harness])
  const overrides = useAppStore((s) => s.tokenOverrides[harness])

  const appliedRef = useRef<AppliedSnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const userHue = brandHue ?? HARNESS_DEFAULT_BRAND_HUE[harness]
    el.dataset.harness = harness
    el.classList.toggle('brand-scope', !dark)
    let raf: number | null = requestAnimationFrame(() => {
      raf = null
      appliedRef.current = syncBrandProps(el, harness, userHue, overrides, dark, appliedRef.current)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [ref, harness, dark, brandHue, overrides])
}

export function useHarnessTheme(): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const brandHue = useAppStore((s) => s.brandHues[harness])
  const overrides = useAppStore((s) => s.tokenOverrides[harness])
  const terminalLightPalette = useAppStore((s) => s.terminalLightPalette)
  const terminalDarkPalette = useAppStore((s) => s.terminalDarkPalette)
  const terminalFontSize = useAppStore((s) => s.terminalFontSize)
  const terminalFontFamily = useAppStore((s) => s.terminalFontFamily)
  const uiFontFamily = useAppStore((s) => s.uiFontFamily)
  const liquidGlass = useAppStore((s) => s.liquidGlass)

  const appliedRef = useRef<AppliedSnapshot>(EMPTY_SNAPSHOT)

  useEffect(() => {
    const userHue = brandHue ?? HARNESS_DEFAULT_BRAND_HUE[harness]
    const root = document.documentElement
    root.dataset.harness = harness
    root.classList.toggle('liquid-glass', shouldApplyLiquidGlassClass(liquidGlass, window.app))
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
      appliedRef.current = syncBrandProps(root, harness, userHue, overrides, dark, appliedRef.current)
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [harness, dark, brandHue, overrides, terminalLightPalette, terminalDarkPalette, terminalFontSize, terminalFontFamily, uiFontFamily, liquidGlass])
}

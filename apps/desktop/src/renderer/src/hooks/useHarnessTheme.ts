import { useEffect, useRef, useState } from 'react'
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

export function useHarnessTheme(): void {
  const dark = useDarkClass()
  const harness = useActiveHarness()
  const claudeHue = useAppStore((s) => s.brandHues.claude)
  const codexHue = useAppStore((s) => s.brandHues.codex)
  const claudeOverrides = useAppStore((s) => s.tokenOverrides.claude)
  const codexOverrides = useAppStore((s) => s.tokenOverrides.codex)

  const appliedRef = useRef<AppliedSnapshot>({ brandHue: null, overrides: {}, dark: false })

  useEffect(() => {
    const userHue = harness === 'codex' ? codexHue : claudeHue
    const overrides = harness === 'codex' ? codexOverrides : claudeOverrides
    const root = document.documentElement
    root.dataset.harness = harness

    let raf: number | null = requestAnimationFrame(() => {
      raf = null
      const prev = appliedRef.current

      if (dark) {
        if (!prev.dark) {
          root.style.removeProperty('--brand-hue')
          for (const token of DESIGN_TOKENS) {
            for (const ch of LCH_CHANNELS) {
              root.style.removeProperty(`${token}-${ch}`)
            }
          }
        }
        appliedRef.current = { brandHue: null, overrides: {}, dark: true }
        return
      }

      if (prev.dark) {
        appliedRef.current = { brandHue: null, overrides: {}, dark: false }
      }

      if (userHue !== prev.brandHue) {
        if (userHue !== null) {
          root.style.setProperty('--brand-hue', String(userHue))
        } else {
          root.style.removeProperty('--brand-hue')
        }
      }

      const prevOv = appliedRef.current.overrides
      const allTokens = new Set([
        ...Object.keys(prevOv),
        ...Object.keys(overrides),
      ])

      for (const tokenKey of allTokens) {
        const cur = overrides[tokenKey as keyof TokenOverrides] as LCHPartial | undefined
        const prv = prevOv[tokenKey as keyof TokenOverrides] as LCHPartial | undefined
        for (const ch of LCH_CHANNELS) {
          const newVal = cur?.[ch]
          const oldVal = prv?.[ch]
          if (newVal === oldVal) continue
          if (newVal !== undefined) {
            root.style.setProperty(`${tokenKey}-${ch}`, String(newVal))
          } else {
            root.style.removeProperty(`${tokenKey}-${ch}`)
          }
        }
      }

      appliedRef.current = { brandHue: userHue, overrides, dark: false }
    })
    return () => {
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [harness, dark, claudeHue, codexHue, claudeOverrides, codexOverrides])
}

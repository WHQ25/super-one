import type { AppSettings } from '@superone/shared/agent-types'
import type { HarnessId } from '@superone/shared/session-types'
import {
  clampA, clampBrandHue, clampC, clampHue, clampL, DARK_DESIGN_TOKENS, HARNESS_DEFAULT_BRAND_HUE,
  type DesignToken, type LCHPartial, type TokenOverrides,
} from '@superone/shared/harness-brand'

export interface HarnessThemeState {
  brandHues: Record<HarnessId, number | null>
  darkBrandHues: Record<HarnessId, number | null>
  tokenOverrides: Record<HarnessId, TokenOverrides>
  darkTokenOverrides: Record<HarnessId, TokenOverrides>
  setBrandHue: (harness: HarnessId, hue: number | null, scheme?: 'light' | 'dark') => Promise<void>
  setTokenOverride: (harness: HarnessId, token: DesignToken, partial: LCHPartial, scheme?: 'light' | 'dark') => Promise<void>
  resetTokenOverride: (harness: HarnessId, token: DesignToken, scheme?: 'light' | 'dark') => Promise<void>
  resetAllTokenOverrides: (harness: HarnessId, scheme?: 'light' | 'dark') => Promise<void>
}

const HARNESSES = Object.keys(HARNESS_DEFAULT_BRAND_HUE) as HarnessId[]
function perHarness<T>(value: (harness: HarnessId) => T): Record<HarnessId, T> {
  return Object.fromEntries(HARNESSES.map(h => [h, value(h)])) as Record<HarnessId, T>
}

/** Startup and settings broadcasts must hydrate the same palette fields. */
export function readHarnessThemeSettings(settings: AppSettings): Pick<HarnessThemeState, 'brandHues' | 'darkBrandHues' | 'tokenOverrides' | 'darkTokenOverrides'> {
  return {
    brandHues: perHarness(h => settings.agentPreference[h]?.brandHue ?? null),
    darkBrandHues: perHarness(h => settings.agentPreference[h]?.darkBrandHue ?? null),
    tokenOverrides: perHarness(h => settings.agentPreference[h]?.tokenOverrides ?? {}),
    darkTokenOverrides: perHarness(h => settings.agentPreference[h]?.darkTokenOverrides ?? {}),
  }
}

export function createHarnessThemeSlice(
  set: (state: Partial<HarnessThemeState>) => void,
  get: () => HarnessThemeState,
): HarnessThemeState {
  const timers: Partial<Record<HarnessId, ReturnType<typeof setTimeout>>> = {}
  const persist = (harness: HarnessId): void => {
    clearTimeout(timers[harness])
    timers[harness] = setTimeout(() => {
      delete timers[harness]
      const state = get()
      void window.app.saveAppSettings({
        agentPreference: {
          [harness]: {
            brandHue: state.brandHues[harness],
            darkBrandHue: state.darkBrandHues[harness],
            tokenOverrides: state.tokenOverrides[harness],
            darkTokenOverrides: state.darkTokenOverrides[harness],
          },
        },
      }).catch(err => console.error('[brand-theme] persist failed:', err))
    }, 150)
  }

  return {
    brandHues: perHarness(() => null),
    darkBrandHues: perHarness(() => null),
    tokenOverrides: perHarness(() => ({})),
    darkTokenOverrides: perHarness(() => ({})),
    setBrandHue: async (harness, hue, scheme = 'light') => {
      const key = scheme === 'dark' ? 'darkBrandHues' : 'brandHues'
      set({ [key]: { ...get()[key], [harness]: hue === null ? null : clampBrandHue(hue) } })
      persist(harness)
    },
    setTokenOverride: async (harness, token, partial, scheme = 'light') => {
      if (scheme === 'dark' && !DARK_DESIGN_TOKENS.includes(token)) return
      const key = scheme === 'dark' ? 'darkTokenOverrides' : 'tokenOverrides'
      const current = get()[key][harness]
      const merged: LCHPartial = { ...current[token] }
      if (partial.l !== undefined) merged.l = clampL(partial.l)
      if (partial.c !== undefined) merged.c = clampC(partial.c)
      if (partial.h !== undefined) merged.h = clampHue(partial.h)
      if (partial.a !== undefined) merged.a = clampA(partial.a)
      set({ [key]: { ...get()[key], [harness]: { ...current, [token]: merged } } })
      persist(harness)
    },
    resetTokenOverride: async (harness, token, scheme = 'light') => {
      const key = scheme === 'dark' ? 'darkTokenOverrides' : 'tokenOverrides'
      const current = get()[key][harness]
      if (!(token in current)) return
      const next = { ...current }
      delete next[token]
      set({ [key]: { ...get()[key], [harness]: next } })
      persist(harness)
    },
    resetAllTokenOverrides: async (harness, scheme = 'light') => {
      const key = scheme === 'dark' ? 'darkTokenOverrides' : 'tokenOverrides'
      set({ [key]: { ...get()[key], [harness]: {} } })
      persist(harness)
    },
  }
}

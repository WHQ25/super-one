import { useCallback, useEffect, useState } from 'react'
import type { HarnessSessionRank, SuggestionHarnessPreference } from '@superone/shared/agent-types'

const EMPTY_RANKS: HarnessSessionRank[] = []
const HARNESS_RANK_DAYS = 7

let rememberedRanks: HarnessSessionRank[] = EMPTY_RANKS
let rememberedSuggestionHarness: SuggestionHarnessPreference | null | undefined
let rememberedSecondaryHarness: SuggestionHarnessPreference | null = null
let rememberedHarnessOrder: string[] = []
let rememberedSuggestionMenuHarness: SuggestionHarnessPreference | null | undefined

export function resetSuggestionPreferencesMemoryForTests(): void {
  rememberedRanks = EMPTY_RANKS
  rememberedSuggestionHarness = undefined
  rememberedSecondaryHarness = null
  rememberedHarnessOrder = []
  rememberedSuggestionMenuHarness = undefined
}

export function useSuggestionPreferences(
  prefsEqual: (
    a: SuggestionHarnessPreference | null | undefined,
    b: SuggestionHarnessPreference | null | undefined,
  ) => boolean,
) {
  const [ranks, setRanks] = useState<HarnessSessionRank[]>(() => rememberedRanks)
  const [suggestionHarness, setSuggestionHarness] = useState<SuggestionHarnessPreference | null | undefined>(
    () => rememberedSuggestionHarness,
  )
  const [secondaryHarness, setSecondaryHarness] = useState<SuggestionHarnessPreference | null>(
    () => rememberedSecondaryHarness,
  )
  const [harnessOrder, setHarnessOrder] = useState<string[]>(() => rememberedHarnessOrder)
  const [suggestionMenuHarness, setSuggestionMenuHarness] = useState<
    SuggestionHarnessPreference | null | undefined
  >(() => rememberedSuggestionMenuHarness)

  useEffect(() => {
    let cancelled = false

    const applySettings = (settings: {
      harnessOrder?: string[]
      suggestionHarness?: SuggestionHarnessPreference | null
      secondaryHarness?: SuggestionHarnessPreference | null
      suggestionMenuHarness?: SuggestionHarnessPreference | null
    } | null) => {
      if (cancelled) return
      const nextOrder = Array.isArray(settings?.harnessOrder) ? settings.harnessOrder : []
      const nextSuggestion = settings?.suggestionHarness ?? null
      const nextSecondary = settings?.secondaryHarness ?? null
      rememberedHarnessOrder = nextOrder
      rememberedSuggestionHarness = nextSuggestion
      rememberedSecondaryHarness = nextSecondary
      setHarnessOrder(nextOrder)
      setSuggestionHarness(nextSuggestion)
      setSecondaryHarness(nextSecondary)
      if (nextSecondary != null) {
        rememberedSuggestionMenuHarness = nextSecondary
        setSuggestionMenuHarness(nextSecondary)
        return
      }
      if (rememberedSuggestionMenuHarness !== undefined) {
        setSuggestionMenuHarness(rememberedSuggestionMenuHarness)
      } else {
        const fromDisk = settings?.suggestionMenuHarness ?? null
        rememberedSuggestionMenuHarness = fromDisk
        setSuggestionMenuHarness(fromDisk)
      }
    }

    void Promise.all([
      window.app.queryHarnessSessionRanks(HARNESS_RANK_DAYS).catch(() => EMPTY_RANKS),
      window.app.getAppSettings().catch(() => null),
    ]).then(([nextRanks, settings]) => {
      if (cancelled) return
      const resolvedRanks = Array.isArray(nextRanks) ? nextRanks : EMPTY_RANKS
      rememberedRanks = resolvedRanks
      setRanks(resolvedRanks)
      applySettings(settings)
    })

    const unsub = window.app.onAppSettingsChange?.((settings) => {
      applySettings(settings)
    })

    return () => {
      cancelled = true
      unsub?.()
    }
  }, [])

  const persistDefaultHarness = useCallback((pref: SuggestionHarnessPreference) => {
    rememberedSuggestionHarness = pref
    setSuggestionHarness(pref)
    const clearsSecondary = prefsEqual(pref, secondaryHarness)
    if (clearsSecondary) {
      rememberedSecondaryHarness = null
      setSecondaryHarness(null)
      rememberedSuggestionMenuHarness = null
      setSuggestionMenuHarness(null)
    }
    void window.app.saveAppSettings({
      suggestionHarness: pref,
      ...(clearsSecondary ? { secondaryHarness: null, suggestionMenuHarness: null } : {}),
    }).catch(() => {
      void 0
    })
  }, [prefsEqual, secondaryHarness])

  const persistSecondaryHarness = useCallback((pref: SuggestionHarnessPreference) => {
    if (prefsEqual(pref, suggestionHarness === undefined ? null : suggestionHarness)) return
    rememberedSecondaryHarness = pref
    setSecondaryHarness(pref)
    rememberedSuggestionMenuHarness = pref
    setSuggestionMenuHarness(pref)
    void window.app.saveAppSettings({
      secondaryHarness: pref,
      suggestionMenuHarness: pref,
    }).catch(() => {
      void 0
    })
  }, [prefsEqual, suggestionHarness])

  return {
    ranks,
    suggestionHarness,
    secondaryHarness,
    harnessOrder,
    suggestionMenuHarness,
    persistDefaultHarness,
    persistSecondaryHarness,
  }
}

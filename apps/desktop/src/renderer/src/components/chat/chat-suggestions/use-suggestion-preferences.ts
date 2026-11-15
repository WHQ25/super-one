import { useCallback, useEffect, useState } from 'react'
import type { HarnessSessionRank, SuggestionHarnessPreference } from '@superone/shared/agent-types'
import {
  readSuggestionPreferenceSnapshot,
  rememberDefaultHarnessPin,
  rememberSecondaryHarnessPin,
  rememberSuggestionPreferences,
  resetSuggestionPreferencesMemoryForTests as resetPreferenceSnapshotForTests,
  type SuggestionPreferenceSettings,
} from '@/lib/suggestion-preferences-memory'

const EMPTY_RANKS: HarnessSessionRank[] = []
const HARNESS_RANK_DAYS = 7

let rememberedRanks: HarnessSessionRank[] = EMPTY_RANKS

export function resetSuggestionPreferencesMemoryForTests(): void {
  rememberedRanks = EMPTY_RANKS
  resetPreferenceSnapshotForTests()
}

export function useSuggestionPreferences(
  prefsEqual: (
    a: SuggestionHarnessPreference | null | undefined,
    b: SuggestionHarnessPreference | null | undefined,
  ) => boolean,
) {
  const [ranks, setRanks] = useState<HarnessSessionRank[]>(() => rememberedRanks)
  const [suggestionHarness, setSuggestionHarness] = useState<SuggestionHarnessPreference | null | undefined>(
    () => readSuggestionPreferenceSnapshot().suggestionHarness,
  )
  const [secondaryHarness, setSecondaryHarness] = useState<SuggestionHarnessPreference | null>(
    () => readSuggestionPreferenceSnapshot().secondaryHarness,
  )
  const [harnessOrder, setHarnessOrder] = useState<string[]>(
    () => readSuggestionPreferenceSnapshot().harnessOrder,
  )
  const [suggestionMenuHarness, setSuggestionMenuHarness] = useState<
    SuggestionHarnessPreference | null | undefined
  >(() => readSuggestionPreferenceSnapshot().suggestionMenuHarness)

  useEffect(() => {
    let cancelled = false

    const applySettings = (settings: SuggestionPreferenceSettings | null) => {
      if (cancelled) return
      const next = rememberSuggestionPreferences(settings)
      setHarnessOrder(next.harnessOrder)
      setSuggestionHarness(next.suggestionHarness ?? null)
      setSecondaryHarness(next.secondaryHarness)
      setSuggestionMenuHarness(next.suggestionMenuHarness ?? null)
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
    const clearsSecondary = prefsEqual(pref, secondaryHarness)
    const next = rememberDefaultHarnessPin(pref, clearsSecondary)
    setSuggestionHarness(next.suggestionHarness ?? null)
    setSecondaryHarness(next.secondaryHarness)
    setSuggestionMenuHarness(next.suggestionMenuHarness ?? null)
    void window.app.saveAppSettings({
      suggestionHarness: pref,
      ...(clearsSecondary ? { secondaryHarness: null, suggestionMenuHarness: null } : {}),
    }).catch(() => {
      void 0
    })
  }, [prefsEqual, secondaryHarness])

  const persistSecondaryHarness = useCallback((pref: SuggestionHarnessPreference) => {
    if (prefsEqual(pref, suggestionHarness === undefined ? null : suggestionHarness)) return
    const next = rememberSecondaryHarnessPin(pref)
    setSecondaryHarness(next.secondaryHarness)
    setSuggestionMenuHarness(next.suggestionMenuHarness ?? null)
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

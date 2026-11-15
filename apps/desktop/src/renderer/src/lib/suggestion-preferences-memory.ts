import type { SuggestionHarnessPreference } from '@superone/shared/agent-types'

/**
 * ChatSuggestions harness order, shared with startup.
 *
 * The new-session page used to paint the product default (Claude Code first)
 * and only then apply the saved order, because settings arrived in an effect.
 * Startup already has those settings before the page mounts. Priming this
 * memory lets the first paint use the saved order.
 *
 * `suggestionHarness === undefined` means settings have not been applied.
 * `null` means Auto.
 */
export interface SuggestionPreferenceSettings {
  harnessOrder?: readonly string[] | null
  suggestionHarness?: SuggestionHarnessPreference | null
  secondaryHarness?: SuggestionHarnessPreference | null
  suggestionMenuHarness?: SuggestionHarnessPreference | null
}

export interface SuggestionPreferenceSnapshot {
  suggestionHarness: SuggestionHarnessPreference | null | undefined
  secondaryHarness: SuggestionHarnessPreference | null
  harnessOrder: string[]
  suggestionMenuHarness: SuggestionHarnessPreference | null | undefined
}

let rememberedSuggestionHarness: SuggestionHarnessPreference | null | undefined
let rememberedSecondaryHarness: SuggestionHarnessPreference | null = null
let rememberedHarnessOrder: string[] = []
let rememberedSuggestionMenuHarness: SuggestionHarnessPreference | null | undefined

export function resetSuggestionPreferencesMemoryForTests(): void {
  rememberedSuggestionHarness = undefined
  rememberedSecondaryHarness = null
  rememberedHarnessOrder = []
  rememberedSuggestionMenuHarness = undefined
}

export function readSuggestionPreferenceSnapshot(): SuggestionPreferenceSnapshot {
  return {
    suggestionHarness: rememberedSuggestionHarness,
    secondaryHarness: rememberedSecondaryHarness,
    harnessOrder: rememberedHarnessOrder,
    suggestionMenuHarness: rememberedSuggestionMenuHarness,
  }
}

/** Undefined until settings have been applied. Null means Auto. */
export function readPrimedSuggestionHarness(): SuggestionHarnessPreference | null | undefined {
  return rememberedSuggestionHarness
}

export function rememberSuggestionPreferences(
  settings: SuggestionPreferenceSettings | null | undefined,
): SuggestionPreferenceSnapshot {
  const nextOrder = Array.isArray(settings?.harnessOrder) ? [...settings.harnessOrder] : []
  const nextSuggestion = settings?.suggestionHarness ?? null
  const nextSecondary = settings?.secondaryHarness ?? null
  rememberedHarnessOrder = nextOrder
  rememberedSuggestionHarness = nextSuggestion
  rememberedSecondaryHarness = nextSecondary
  if (nextSecondary != null) {
    rememberedSuggestionMenuHarness = nextSecondary
  } else if (rememberedSuggestionMenuHarness === undefined) {
    rememberedSuggestionMenuHarness = settings?.suggestionMenuHarness ?? null
  }
  return readSuggestionPreferenceSnapshot()
}

export function primeSuggestionPreferences(
  settings: SuggestionPreferenceSettings | null | undefined,
): void {
  rememberSuggestionPreferences(settings)
}

export function rememberDefaultHarnessPin(
  pref: SuggestionHarnessPreference,
  clearsSecondary: boolean,
): SuggestionPreferenceSnapshot {
  rememberedSuggestionHarness = pref
  if (clearsSecondary) {
    rememberedSecondaryHarness = null
    rememberedSuggestionMenuHarness = null
  }
  return readSuggestionPreferenceSnapshot()
}

export function rememberSecondaryHarnessPin(
  pref: SuggestionHarnessPreference,
): SuggestionPreferenceSnapshot {
  rememberedSecondaryHarness = pref
  rememberedSuggestionMenuHarness = pref
  return readSuggestionPreferenceSnapshot()
}

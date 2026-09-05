"use client"

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import {
  clampBrandHue,
  HARNESS_DEFAULT_BRAND_HUE,
} from "@superone/shared/harness-brand"

const STORAGE_KEY = "superone.web.brandHue"
export const DEFAULT_BRAND_HUE = HARNESS_DEFAULT_BRAND_HUE.claude

interface BrandHueContextValue {
  brandHue: number
  setBrandHue: (hue: number | null) => void
  isCustom: boolean
  reset: () => void
}

const BrandHueContext = createContext<BrandHueContextValue | null>(null)

/**
 * localStorage is an external store, so it is subscribed to rather than copied
 * into state by an effect on mount. The snapshot is cached because
 * useSyncExternalStore compares it by identity on every render and would loop
 * if getSnapshot re-read storage each time.
 */
const listeners = new Set<() => void>()
let snapshot: number | null = null
let hasRead = false

function readStoredHue(): number | null {
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampBrandHue(parsed) : null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): number | null {
  if (!hasRead) {
    snapshot = readStoredHue()
    hasRead = true
  }
  return snapshot
}

/** Server-rendered markup always shows the default hue. */
function getServerSnapshot(): number | null {
  return null
}

function setBrandHue(hue: number | null): void {
  if (hue === null) {
    window.localStorage.removeItem(STORAGE_KEY)
    snapshot = null
  } else {
    const clamped = clampBrandHue(hue)
    window.localStorage.setItem(STORAGE_KEY, String(clamped))
    snapshot = clamped
  }
  hasRead = true
  for (const listener of listeners) listener()
}

function reset(): void {
  setBrandHue(null)
}

export function BrandHueProvider({ children }: { children: ReactNode }) {
  const storedHue = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  const value = useMemo<BrandHueContextValue>(
    () => ({
      brandHue: storedHue ?? DEFAULT_BRAND_HUE,
      setBrandHue,
      isCustom: storedHue !== null,
      reset,
    }),
    [storedHue],
  )

  return <BrandHueContext.Provider value={value}>{children}</BrandHueContext.Provider>
}

export function useBrandHue(): BrandHueContextValue {
  const ctx = useContext(BrandHueContext)
  if (!ctx) throw new Error("useBrandHue must be used inside <BrandHueProvider>")
  return ctx
}

"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
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

function readStoredHue(): number | null {
  if (typeof window === "undefined") return null
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? clampBrandHue(parsed) : null
}

export function BrandHueProvider({ children }: { children: ReactNode }) {
  const [storedHue, setStoredHue] = useState<number | null>(null)

  useEffect(() => {
    setStoredHue(readStoredHue())
  }, [])

  const setBrandHue = useCallback((hue: number | null) => {
    if (hue === null) {
      window.localStorage.removeItem(STORAGE_KEY)
      setStoredHue(null)
      return
    }
    const clamped = clampBrandHue(hue)
    window.localStorage.setItem(STORAGE_KEY, String(clamped))
    setStoredHue(clamped)
  }, [])

  const value = useMemo<BrandHueContextValue>(
    () => ({
      brandHue: storedHue ?? DEFAULT_BRAND_HUE,
      setBrandHue,
      isCustom: storedHue !== null,
      reset: () => setBrandHue(null),
    }),
    [storedHue, setBrandHue],
  )

  return <BrandHueContext.Provider value={value}>{children}</BrandHueContext.Provider>
}

export function useBrandHue(): BrandHueContextValue {
  const ctx = useContext(BrandHueContext)
  if (!ctx) throw new Error("useBrandHue must be used inside <BrandHueProvider>")
  return ctx
}

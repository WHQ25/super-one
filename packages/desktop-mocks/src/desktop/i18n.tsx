import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { Locale } from "@superone/shared/agent-types"
import { resources } from "@superone/shared/i18n"

type Vars = Record<string, string | number>

function lookup(locale: Locale, key: string): string | undefined {
  const root = resources[locale]?.translation as Record<string, unknown> | undefined
  if (!root) return undefined
  let cur: unknown = root
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part]
    } else {
      return undefined
    }
  }
  return typeof cur === "string" ? cur : undefined
}

function interpolate(value: string, vars?: Vars): string {
  if (!vars) return value
  return value.replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{{${name}}}`,
  )
}

export type MockT = (key: string, vars?: Vars) => string

export function createT(locale: Locale): MockT {
  return (key, vars) => {
    let resolvedKey = key
    if (vars && typeof vars.count === "number") {
      const pluralKey = vars.count === 1 ? `${key}_one` : `${key}_other`
      if (lookup(locale, pluralKey) ?? lookup("en", pluralKey)) resolvedKey = pluralKey
    }
    const raw = lookup(locale, resolvedKey) ?? lookup("en", resolvedKey) ?? key
    return interpolate(raw, vars)
  }
}

interface MockLocaleValue {
  locale: Locale
  t: MockT
}

const MockLocaleContext = createContext<MockLocaleValue>({
  locale: "en",
  t: createT("en"),
})

export function MockLocaleProvider({
  locale,
  children,
}: {
  locale: Locale
  children: ReactNode
}) {
  const value = useMemo<MockLocaleValue>(() => ({ locale, t: createT(locale) }), [locale])
  return <MockLocaleContext.Provider value={value}>{children}</MockLocaleContext.Provider>
}

export function useMockT(): MockT {
  return useContext(MockLocaleContext).t
}

export function useMockLocale(): Locale {
  return useContext(MockLocaleContext).locale
}

import type { ComponentType } from "react"
import type { Locale } from "@/i18n/routing"

export type ChangelogCategory =
  | "feature"
  | "improvement"
  | "fix"
  | "announcement"

export type ChangelogHero =
  | { type: "image"; src: string; alt?: string }
  | { type: "video"; src: string; poster?: string }
  | { type: "gradient"; from: string; to: string; accent?: string }

export type ChangelogMeta = {
  date: string
  category: ChangelogCategory
  version?: string
  title: Record<Locale, string>
  summary: Record<Locale, string>
  hero?: ChangelogHero
  tags?: string[]
}

export type ChangelogEntry = ChangelogMeta & {
  slug: string
  body: Record<Locale, ComponentType>
}

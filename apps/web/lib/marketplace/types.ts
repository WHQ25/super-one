import type { Locale } from "@/i18n/routing"

export type Localized = Record<Locale, string>

export type AuthorType = "official" | "community"

export type SkillCategory =
  | "development"
  | "writing"
  | "research"
  | "data"
  | "productivity"
  | "creative"

export type SkillEntry = {
  slug: string
  emoji: string
  hue: number
  name: Localized
  tagline: Localized
  description: Localized
  category: SkillCategory
  authorType: AuthorType
  authorName: string
  tags: string[]
  examplePrompts: Localized[]
  featured?: boolean
}

export type McpCategory =
  | "devtools"
  | "storage"
  | "productivity"
  | "search"
  | "cloud"
  | "communication"

export type McpTransport = "stdio" | "http" | "sse"

export type McpEntry = {
  slug: string
  emoji: string
  hue: number
  name: Localized
  vendor: string
  tagline: Localized
  description: Localized
  category: McpCategory
  authorType: AuthorType
  transport: McpTransport
  authRequired: boolean
  capabilities: {
    tools: number
    resources: number
    prompts: number
  }
  highlightedTools: string[]
  tags: string[]
  featured?: boolean
}

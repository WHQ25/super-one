import type {
  McpCategory,
  McpEntry,
  SkillCategory,
  SkillEntry,
} from "./types"

export type SkillListResponse = {
  items: SkillEntry[]
  total: number
  featured: SkillEntry[]
}

export type McpListResponse = {
  items: McpEntry[]
  total: number
  featured: McpEntry[]
}

export type SkillListQuery = {
  category?: SkillCategory | "all"
  q?: string
}

export type McpListQuery = {
  category?: McpCategory | "all"
  q?: string
}

function buildQuery(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v && v !== "all") usp.set(k, v)
  }
  const s = usp.toString()
  return s ? `?${s}` : ""
}

export async function listSkills(
  query: SkillListQuery = {},
  init?: { baseUrl?: string; signal?: AbortSignal },
): Promise<SkillListResponse> {
  const qs = buildQuery({ category: query.category, q: query.q })
  const res = await fetch(`${init?.baseUrl ?? ""}/api/skills${qs}`, {
    cache: "no-store",
    signal: init?.signal,
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as SkillListResponse
}

export async function getSkill(
  slug: string,
  init?: { baseUrl?: string },
): Promise<SkillEntry | null> {
  const res = await fetch(
    `${init?.baseUrl ?? ""}/api/skills/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const json = (await res.json()) as { entry: SkillEntry }
  return json.entry
}

export async function listMcps(
  query: McpListQuery = {},
  init?: { baseUrl?: string; signal?: AbortSignal },
): Promise<McpListResponse> {
  const qs = buildQuery({ category: query.category, q: query.q })
  const res = await fetch(`${init?.baseUrl ?? ""}/api/mcps${qs}`, {
    cache: "no-store",
    signal: init?.signal,
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return (await res.json()) as McpListResponse
}

export async function getMcp(
  slug: string,
  init?: { baseUrl?: string },
): Promise<McpEntry | null> {
  const res = await fetch(
    `${init?.baseUrl ?? ""}/api/mcps/${encodeURIComponent(slug)}`,
    { cache: "no-store" },
  )
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  const json = (await res.json()) as { entry: McpEntry }
  return json.entry
}

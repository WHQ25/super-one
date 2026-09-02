import { NextResponse } from "next/server"
import { MCPS } from "@/lib/marketplace/mock-db"
import type { McpCategory } from "@/lib/marketplace/types"

const ALL_CATEGORIES: ReadonlyArray<McpCategory> = [
  "devtools",
  "storage",
  "productivity",
  "search",
  "cloud",
  "communication",
]

function isCategory(value: string): value is McpCategory {
  return (ALL_CATEGORIES as ReadonlyArray<string>).includes(value)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get("category")
  const q = searchParams.get("q")?.trim().toLowerCase() ?? ""

  let items = [...MCPS]

  if (category && isCategory(category)) {
    items = items.filter((m) => m.category === category)
  }

  if (q.length > 0) {
    items = items.filter((m) => {
      const haystack = [
        m.slug,
        m.name.en,
        m.name.zh,
        m.tagline.en,
        m.tagline.zh,
        m.vendor,
        m.highlightedTools.join(" "),
        m.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  const featured = MCPS.filter((m) => m.featured)

  return NextResponse.json({
    items,
    total: items.length,
    featured,
  })
}

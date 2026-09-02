import { NextResponse } from "next/server"
import { SKILLS } from "@/lib/marketplace/mock-db"
import type { SkillCategory } from "@/lib/marketplace/types"

const ALL_CATEGORIES: ReadonlyArray<SkillCategory> = [
  "development",
  "writing",
  "research",
  "data",
  "productivity",
  "creative",
]

function isCategory(value: string): value is SkillCategory {
  return (ALL_CATEGORIES as ReadonlyArray<string>).includes(value)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const category = searchParams.get("category")
  const q = searchParams.get("q")?.trim().toLowerCase() ?? ""

  let items = [...SKILLS]

  if (category && isCategory(category)) {
    items = items.filter((s) => s.category === category)
  }

  if (q.length > 0) {
    items = items.filter((s) => {
      const haystack = [
        s.slug,
        s.name.en,
        s.name.zh,
        s.tagline.en,
        s.tagline.zh,
        s.authorName,
        s.tags.join(" "),
      ]
        .join(" ")
        .toLowerCase()
      return haystack.includes(q)
    })
  }

  const featured = SKILLS.filter((s) => s.featured)

  return NextResponse.json({
    items,
    total: items.length,
    featured,
  })
}

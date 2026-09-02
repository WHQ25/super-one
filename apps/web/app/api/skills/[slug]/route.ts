import { NextResponse } from "next/server"
import { findSkill } from "@/lib/marketplace/mock-db"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params
  const entry = findSkill(slug)
  if (!entry) {
    return NextResponse.json({ error: "not_found" }, { status: 404 })
  }
  return NextResponse.json({ entry })
}

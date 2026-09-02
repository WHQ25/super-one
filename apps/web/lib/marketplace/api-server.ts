import "server-only"
import { headers } from "next/headers"
import * as api from "./api"

async function resolveBaseUrl(): Promise<string> {
  const override = process.env.NEXT_PUBLIC_SITE_ORIGIN
  if (override) return override.replace(/\/$/, "")
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https")
  return `${proto}://${host}`
}

export async function listSkills(query: api.SkillListQuery = {}) {
  const baseUrl = await resolveBaseUrl()
  return api.listSkills(query, { baseUrl })
}

export async function getSkill(slug: string) {
  const baseUrl = await resolveBaseUrl()
  return api.getSkill(slug, { baseUrl })
}

export async function listMcps(query: api.McpListQuery = {}) {
  const baseUrl = await resolveBaseUrl()
  return api.listMcps(query, { baseUrl })
}

export async function getMcp(slug: string) {
  const baseUrl = await resolveBaseUrl()
  return api.getMcp(slug, { baseUrl })
}

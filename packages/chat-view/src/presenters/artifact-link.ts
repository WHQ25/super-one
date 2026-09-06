/**
 * Resolve the openable URL behind an `Artifact` tool call.
 *
 * The tool publishes a page to claude.ai and (SDK 0.3.238+) manages that page's
 * asset store, so the URL lives in a different place per action: a publish
 * returns it in the result, while every asset action targets an artifact the
 * caller already named in the input. The result is only present once the call
 * settles, so the input fallback is also what makes the link appear while the
 * call is still streaming.
 */
export interface ArtifactLink {
  url: string
  label: string
}

function isHttpUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

/** Host + path, without the scheme — the whole URL rarely fits a tool row. */
export function artifactLinkLabel(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')
    return `${u.host.replace(/^www\./, '')}${path}`
  } catch {
    return url
  }
}

export function resolveArtifactLink(
  params: Record<string, unknown>,
  result: string | null | undefined,
): ArtifactLink | null {
  let parsed: Record<string, unknown> | null = null
  if (result) {
    try {
      const value = JSON.parse(result) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>
    } catch {
      // Non-JSON result (an error string, a plain URL echo) — fall through to the input.
    }
  }

  // A publish reports the page it wrote, which may differ from any input url.
  if (isHttpUrl(parsed?.url)) {
    const title = typeof parsed?.title === 'string' ? parsed.title.trim() : ''
    return { url: parsed.url, label: title || artifactLinkLabel(parsed.url) }
  }

  // upload_asset reports the stored asset's own URL; name it by the file.
  const upload = parsed?.asset_upload
  if (upload && typeof upload === 'object' && isHttpUrl((upload as Record<string, unknown>).url)) {
    const u = upload as Record<string, unknown>
    const fileName = typeof u.file_name === 'string' ? u.file_name.trim() : ''
    return { url: u.url as string, label: fileName || artifactLinkLabel(u.url as string) }
  }

  // Every other action (list_assets / read_asset / delete_asset, and any call
  // still streaming) points at the artifact named in the input.
  if (isHttpUrl(params.url)) {
    const title = typeof params.title === 'string' ? params.title.trim() : ''
    return { url: params.url, label: title || artifactLinkLabel(params.url) }
  }

  return null
}

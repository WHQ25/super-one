/**
 * Presentation for Claude's Artifact tool family.
 *
 * `Artifact` publishes a page to claude.ai and manages it (list, read, assets, pins);
 * `ArtifactComments`, `ArtifactData` and `ArtifactCheck` act on a published page named
 * by its `url`. Every action is an input field, so the header names the action. Only
 * `Artifact` rows carry the page's link — the companions name what they did to it.
 *
 * The openable URL lives in a different place per action: a publish reports it in the
 * result (plain text from the CLI, JSON in older shapes), an upload reports the asset's
 * own URL, and every other action targets the artifact named in the input. The result
 * is only present once the call settles, so the input fallback is also what makes the
 * link appear while the call is still streaming.
 */

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** `upload_asset` → `upload asset`; the header's action fragment. */
function actionLabel(action: string): string {
  return action.replace(/_/g, ' ')
}

/**
 * The header summary: which action ran, and on what. Identity of the page itself
 * comes from the link chip, so it is never repeated here.
 */
export function artifactToolSummary(toolName: string, input: Record<string, unknown>): string {
  const action = text(input.action)
  if (toolName === 'Artifact') {
    switch (action || 'publish') {
      case 'publish':
        // Publish is the unlabeled action; a title names it, else the source file —
        // which is the only locator a failed or denied publish has.
        return text(input.title) || text(input.file_path).split('/').pop() || ''
      case 'list': {
        const scope = text(input.scope)
        return scope && scope !== 'mine' ? `list · ${scope}` : 'list'
      }
      default:
        return actionLabel(action)
    }
  }
  if (toolName === 'ArtifactData') {
    const target = [text(input.collection), text(input.doc_id)].filter(Boolean).join('/')
    return [actionLabel(action), target].filter(Boolean).join(' · ')
  }
  return actionLabel(action)
}

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

const HTML_TITLE = /<title[^>]*>([^<]{1,200})<\/title>/i
const HTML_ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }

function htmlTitle(text: string): string {
  const raw = HTML_TITLE.exec(text.slice(0, 16_384))?.[1] ?? ''
  return raw.replace(/&(amp|lt|gt|quot|#39);/g, (entity) => HTML_ENTITIES[entity]).trim()
}

function linkTo(url: string, name?: unknown): ArtifactLink {
  return { url, label: text(name) || artifactLinkLabel(url) }
}

// `Published <path> at <url> (Version 2, version id …)` — the CLI's publish result.
const PUBLISHED_URL = /^Published\b[^\n]*? at (https?:\/\/[^\s()]+)/

/** `resultTitle` is the page title the host read from the structured result, when it has one. */
export function resolveArtifactLink(
  params: Record<string, unknown>,
  result: string | null | undefined,
  resultTitle?: string,
): ArtifactLink | null {
  let parsed: Record<string, unknown> | null = null
  if (result) {
    try {
      const value = JSON.parse(result) as unknown
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Record<string, unknown>
    } catch {
      // Non-JSON result (the CLI's text, an error string) — handled below.
    }
  }

  // A publish reports the page it wrote, which may differ from any input url.
  if (isHttpUrl(parsed?.url)) return linkTo(parsed.url, parsed.title)
  const published = !parsed && result ? PUBLISHED_URL.exec(result)?.[1] : undefined
  if (published) return linkTo(published, params.title || resultTitle)

  // upload_asset reports the stored asset's own URL; name it by the file.
  const upload = parsed?.asset_upload
  if (upload && typeof upload === 'object' && isHttpUrl((upload as Record<string, unknown>).url)) {
    const u = upload as Record<string, unknown>
    return linkTo(u.url as string, u.file_name)
  }

  // Every other action (and any call still streaming) points at the artifact named in the
  // input; a read of the person's own page returns its HTML, whose <title> names it.
  if (isHttpUrl(params.url)) return linkTo(params.url, params.title || resultTitle || (!parsed && result ? htmlTitle(result) : ''))

  return null
}

export interface ArtifactListItem {
  url: string
  /** The artifact's title, else the link's host + path. */
  label: string
  /** Last update as the listing states it (`2026-10-15`), or empty. */
  updated: string
  /** Row qualifiers worth showing — `shared`, a role, `pinned`; never the default `mine`. */
  tags: string[]
}

export type ArtifactListLine = { kind: 'item'; item: ArtifactListItem } | { kind: 'note'; text: string }

// `- (mine) Title — https://claude.ai/artifact/… — updated 2026-10-15`
const LIST_ROW = /^-\s+((?:\([^)]*\)\s*)*)(.*?)\s+—\s+(https?:\/\/[^\s]+)(.*)$/

function listTags(values: Array<unknown>): string[] {
  return values.filter((v): v is string => typeof v === 'string' && v !== '' && v !== 'mine')
}

/**
 * A `list` result as rows to link. The CLI answers in text — one `- (tags) title — url —
 * updated date` row per artifact around a count line and paging notes, which stay as
 * notes so nothing it said is lost; the typed tool output is JSON. `null` when no row
 * parses, so the caller falls back to the raw text.
 */
export function parseArtifactList(result: string): ArtifactListLine[] | null {
  try {
    const value = JSON.parse(result) as { artifacts?: unknown }
    if (Array.isArray(value?.artifacts)) {
      const items = value.artifacts.flatMap((row): ArtifactListLine[] => {
        const r = (row ?? {}) as Record<string, unknown>
        if (!isHttpUrl(r.url)) return []
        const updated = text(r.updatedAt).slice(0, 10)
        return [{ kind: 'item', item: { ...linkTo(r.url, r.title), updated, tags: listTags([r.rel, r.role, r.pinned ? 'pinned' : '']) } }]
      })
      return items.length > 0 ? items : null
    }
  } catch {
    // The CLI's text listing — parsed below.
  }

  let found = false
  const lines = result.split('\n').flatMap((raw): ArtifactListLine[] => {
    const line = raw.trim()
    if (!line) return []
    const row = LIST_ROW.exec(line)
    if (!row) return [{ kind: 'note', text: line }]
    found = true
    const [, tagText, title, url, rest] = row
    const extras = rest.split(/\s+—\s+/).map((part) => part.trim()).filter(Boolean)
    const updated = extras.find((part) => part.startsWith('updated '))?.slice('updated '.length) ?? ''
    const tags = listTags([...tagText.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()))
    return [{ kind: 'item', item: { ...linkTo(url, title), updated, tags: [...tags, ...extras.filter((part) => !part.startsWith('updated '))] } }]
  })
  return found ? lines : null
}

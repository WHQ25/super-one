import type { RelayClient } from '@superone/relay-client'
import { LIST_FILES_EXCLUDED } from '@superone/shared/list-files-excluded'
import type { RemoteCommand } from '@superone/shared/agent-types'
import { randomId } from './ids'
import { resolveBrowsePath } from './mention-browse-state'
import type { MentionItem } from './mentions'

export interface BrowseEntry {
  name: string
  isDirectory: boolean
}

export interface BrowseResult {
  items: MentionItem[]
  error?: string
}

type ListDirectoryReply = {
  items?: unknown
  appliedIgnoreMode?: unknown
  error?: unknown
}

function parseEntries(raw: unknown): BrowseEntry[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((row): BrowseEntry[] => {
    if (!row || typeof row !== 'object') return []
    const value = row as Record<string, unknown>
    if (typeof value.name !== 'string' || !value.name) return []
    return [{ name: value.name, isDirectory: value.isDirectory === true }]
  })
}

/**
 * Turn a directory listing into rows the composer can insert or descend into.
 *
 * `dir-entry` is the kind that means "still navigable text": inserting a
 * directory row appends its separator and keeps the query open, rather than
 * committing a chip the user cannot type past.
 */
export function browseItems(entries: BrowseEntry[], dir: string): MentionItem[] {
  return entries.map((entry) => ({
    kind: 'dir-entry',
    path: `${dir}${entry.name}`,
    isDirectory: entry.isDirectory,
    label: entry.name,
  }))
}

/**
 * List one directory under the session's checkout.
 *
 * `ignoreMode: 'gitignore'` is a **deliberate divergence from the desktop file
 * picker**, which applies only the fixed exclusion set. A phone has no keyboard
 * to type past a project's generated output. A host that predates the option
 * answers unfiltered and says so, and the fixed set is then applied here so the
 * listing is at least never a wall of dependencies.
 */
export async function requestDirectory(
  client: Pick<RelayClient, 'request'>,
  root: string,
  dir: string,
): Promise<BrowseResult> {
  const reply = await client.request({
    type: 'list_directory',
    requestId: randomId(),
    path: resolveBrowsePath(root, dir),
    showHidden: true,
    ignoreMode: 'gitignore',
  } as RemoteCommand) as ListDirectoryReply
  if (typeof reply?.error === 'string' && reply.error) return { items: [], error: reply.error }
  const entries = parseEntries(reply?.items)
  const filtered = reply?.appliedIgnoreMode === 'gitignore'
    ? entries
    : entries.filter((entry) => !LIST_FILES_EXCLUDED.has(entry.name))
  return { items: browseItems(filtered, dir) }
}

/** Client-side match for a directory the host could not scope-search for us. */
export function filterBrowseItems(items: MentionItem[], needle: string): MentionItem[] {
  const lowered = needle.trim().toLowerCase()
  if (!lowered) return items
  return items.filter((item) => (item.label ?? item.path).toLowerCase().includes(lowered))
}

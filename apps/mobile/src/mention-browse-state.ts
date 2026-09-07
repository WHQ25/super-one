/**
 * What an `@` query means, derived rather than stored.
 *
 * A composer that keeps `mode`, `scopeDir` and the query as separate state has
 * to keep them in sync on every keystroke; deriving them means they cannot
 * disagree. The one thing that genuinely is state — which directory the user
 * navigated into — lives in the draft itself, as the text after `@`.
 */

export type MentionMode =
  /** `@` or `@src/` — list a directory's immediate children. */
  | { kind: 'browse'; dir: string }
  /** `@app` or `@src/app` — fuzzy search, optionally confined to a directory. */
  | { kind: 'search'; needle: string; scopeDir: string }

export function deriveMentionMode(query: string): MentionMode {
  if (!query || query.endsWith('/')) return { kind: 'browse', dir: query }
  const lastSlash = query.lastIndexOf('/')
  if (lastSlash < 0) return { kind: 'search', needle: query, scopeDir: '' }
  return { kind: 'search', needle: query.slice(lastSlash + 1), scopeDir: query.slice(0, lastSlash + 1) }
}

/** The directory a query is anchored to, whichever mode it is in. */
export function mentionScopeDir(query: string): string {
  const mode = deriveMentionMode(query)
  return mode.kind === 'browse' ? mode.dir : mode.scopeDir
}

/** Trail of directory segments, for a breadcrumb that can walk back out. */
export function mentionBreadcrumbs(query: string): { label: string; query: string }[] {
  const segments = mentionScopeDir(query).split('/').filter(Boolean)
  return segments.map((label, index) => ({ label, query: `${segments.slice(0, index + 1).join('/')}/` }))
}

/** Query that opens a directory listed inside `dir`. */
export function enterDirectoryQuery(dir: string, name: string): string {
  return `${dir}${name}/`
}

/**
 * Join a browse directory onto an absolute project root.
 *
 * POSIX, Windows drive roots and UNC share roots all have to survive, so the
 * root's own separator wins rather than a hardcoded `/`.
 */
export function resolveBrowsePath(root: string, dir: string): string {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'
  // A root that is only a separator (`/`) must not gain a second one.
  const base = root.replace(/[/\\]+$/, '') || root
  const relative = dir.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '')
  if (!relative) return base
  const joiner = base.endsWith(separator) ? '' : separator
  return `${base}${joiner}${relative.split('/').join(separator)}`
}

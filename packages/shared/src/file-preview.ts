/**
 * Inline file preview policy shared by the desktop host and the phone.
 *
 * A small text-like file can ride back inside the `read_desktop_file` RPC
 * response itself instead of going through a signed LAN URL or an encrypted
 * relay upload. Both ends need the same answer to "is this file small enough
 * and text enough", so the rule lives here rather than in either app.
 */

/**
 * Upper bound for a file the host may return inline as UTF-8 text.
 * Matches the inline threshold already used for uploads,
 * so one number governs every "small enough to ride the RPC channel" decision.
 */
export const INLINE_PREVIEW_MAX_BYTES = 256 * 1024

/** Extensions the phone can render as plain text or code. */
const INLINE_PREVIEW_EXTENSIONS: ReadonlySet<string> = new Set([
  // prose / config
  '.md', '.mdx', '.markdown', '.txt', '.text', '.rst', '.adoc', '.log',
  '.json', '.jsonc', '.json5', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf',
  '.xml', '.plist', '.csv', '.tsv', '.properties', '.editorconfig', '.gitignore', '.gitattributes',
  '.npmrc', '.nvmrc', '.prettierrc', '.eslintrc', '.babelrc', '.dockerignore',
  // web
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.vue', '.svelte', '.astro',
  // js / ts
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  // other languages
  '.py', '.pyi', '.rb', '.php', '.go', '.rs', '.java', '.kt', '.kts', '.scala', '.groovy',
  '.swift', '.m', '.mm', '.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.cs', '.fs',
  '.dart', '.lua', '.pl', '.pm', '.r', '.jl', '.ex', '.exs', '.erl', '.hs', '.elm', '.clj',
  '.cljs', '.edn', '.zig', '.nim', '.v', '.sol', '.tf', '.hcl', '.proto', '.graphql', '.gql',
  '.sql', '.prisma', '.sh', '.bash', '.zsh', '.fish', '.ps1', '.bat', '.cmd', '.nix',
  '.cmake', '.mk', '.gradle', '.tex', '.bib', '.diff', '.patch', '.lock',
])

/** Extension-less files that are text by convention. */
const INLINE_PREVIEW_BASENAMES: ReadonlySet<string> = new Set([
  'makefile', 'dockerfile', 'containerfile', 'license', 'licence', 'readme', 'changelog',
  'authors', 'contributors', 'codeowners', 'procfile', 'gemfile', 'rakefile', 'brewfile',
  'podfile', 'fastfile', 'appfile', 'matchfile', 'vagrantfile', 'justfile', 'cname',
])

const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.mdx', '.markdown'])

/** Lower-cased extension including the dot, or `''` when the name has none. */
function extensionOf(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name
  const dot = base.lastIndexOf('.')
  if (dot < 0) return ''
  // A dotfile (`.gitignore`) has no stem; its whole name is what the table lists.
  return base.slice(dot).toLowerCase()
}

/**
 * Whether a file's NAME says it is text the phone can show. This is only the
 * name-side half of the check: the host still sniffs the bytes for a NUL before
 * trusting the extension, because `.log` or `.txt` can be anything.
 */
export function isInlinePreviewTextName(name: string): boolean {
  const base = (name.split(/[/\\]/).pop() ?? name).toLowerCase()
  return INLINE_PREVIEW_BASENAMES.has(base) || INLINE_PREVIEW_EXTENSIONS.has(extensionOf(base))
}

/** Name says text AND the file is small enough to ride the RPC response. */
export function isInlinePreviewCandidate(name: string, size: number): boolean {
  return size <= INLINE_PREVIEW_MAX_BYTES && isInlinePreviewTextName(name)
}

/** Whether the phone should render the text as Markdown rather than as code. */
export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name))
}

/**
 * How many leading bytes to sniff for a NUL before declaring a file binary.
 * Matches git's heuristic, which is what most tools already agree with.
 */
export const BINARY_SNIFF_BYTES = 8 * 1024

/** True when the sampled bytes contain a NUL, which no text encoding produces. */
export function looksBinary(sample: Uint8Array): boolean {
  const end = Math.min(sample.length, BINARY_SNIFF_BYTES)
  for (let i = 0; i < end; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

/**
 * Inline file preview policy shared by the desktop host and the phone.
 *
 * A small file can ride back inside the `read_desktop_file` RPC response
 * itself instead of going through a signed LAN URL or an encrypted relay
 * upload. Text uses this on every transport; binary uses it over the relay
 * only (LAN keeps the HTTP path). Both ends need the same answer to "is this
 * small enough to ride the RPC channel", so the rule lives here.
 */

/**
 * Upper bound for a file the host may return in-band on the encrypted
 * RPC/WebSocket. Matches the inline threshold already used for uploads,
 * so one number governs every "small enough to ride the RPC channel" decision.
 */
export const INLINE_RPC_MAX_BYTES = 512 * 1024
/** Same cap as `INLINE_RPC_MAX_BYTES`; the name used by the text-preview path. */
export const INLINE_PREVIEW_MAX_BYTES = INLINE_RPC_MAX_BYTES

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

/**
 * Preview classification shared by every surface that opens a file by name:
 * the activity panel (`FilePreview`), the host's `readProjectFile`, the
 * remote-node file tree and the `@native/files-previewer` payload builder.
 * One table, dotted lower-case extensions, so a kind one side emits is a
 * kind every other side renders.
 */
/** Raster images: opaque bytes the host serves by URL, never as text. */
export const BINARY_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico'])
/** Everything that previews as a picture, including SVG (which the host still reads as text). */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([...BINARY_IMAGE_EXTENSIONS, '.svg'])
export const PDF_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf'])
export const AUDIO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp3', '.wav', '.flac', '.aac', '.m4a'])
export const NOTEBOOK_EXTENSIONS: ReadonlySet<string> = new Set(['.ipynb'])
export const MARKDOWN_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.mdx', '.markdown'])

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
  return isInlineRpcCandidate(size) && isInlinePreviewTextName(name)
}

/** Byte length small enough to ride the encrypted RPC/WebSocket. */
export function isInlineRpcCandidate(size: number): boolean {
  return Number.isFinite(size) && size >= 0 && size <= INLINE_RPC_MAX_BYTES
}

/**
 * Whether a binary (or otherwise non-text) file should come back as inline
 * bytes instead of a download URL. LAN keeps the signed HTTP path; the relay
 * inlines so a 20 KB screenshot does not stage an encrypted copy on R2.
 */
export function shouldInlineRpcBytes(
  transport: 'lan' | 'relay' | null | undefined,
  size: number,
): boolean {
  return transport !== 'lan' && isInlineRpcCandidate(size)
}

/** Whether the phone should render the text as Markdown rather than as code. */
export function isMarkdownFileName(name: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extensionOf(name))
}

/**
 * Containers both chat surfaces treat as a video: the desktop's markdown
 * `<video>` and the phone's poster tile. Matches what the host's media
 * server serves and Chromium decodes.
 */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(['.mp4', '.m4v', '.webm', '.ogg', '.mov'])

/** Whether a file's NAME says it is a video the transcript can preview. */
export function isVideoFileName(name: string): boolean {
  return VIDEO_EXTENSIONS.has(extensionOf(name))
}

/** What a file's NAME says about how it previews; the host corrects `text` by sniffing bytes. */
export type FilePreviewKind = 'image' | 'pdf' | 'video' | 'audio' | 'markdown' | 'notebook' | 'text'

/**
 * Name-only classification. `.ogg` is a video container here because the
 * activity panel checks video before audio; a `<video>` element still plays
 * an audio-only ogg, the reverse is not true.
 */
export function fileKindFromName(name: string): FilePreviewKind {
  const ext = extensionOf(name)
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (VIDEO_EXTENSIONS.has(ext)) return 'video'
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (NOTEBOOK_EXTENSIONS.has(ext)) return 'notebook'
  return 'text'
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

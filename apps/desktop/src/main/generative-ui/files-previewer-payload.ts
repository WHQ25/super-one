/**
 * `widget_show({ template: '@native/files-previewer' })` — resolve the agent's file list into
 * render items the chat can mount without guessing.
 *
 * The payload carries verdicts, not bytes: kind by name, existence and size by `stat`, a NUL
 * sniff for anything that claims to be text, and a readable-roots check so a file the media
 * server would 403 is reported `unpreviewable` here rather than failing in an `<img>` later.
 * Bytes stay on disk; the renderer reads the current slide when it shows it.
 */
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename, isAbsolute, join, resolve } from 'node:path'
import {
  FILES_PREVIEWER_MAX_FILES,
  FILES_PREVIEWER_MAX_NOTE_CHARS,
  type NativeWidgetPayload,
  type PreviewerFile,
  type PreviewerFileKind,
  type PreviewerUnpreviewableReason,
} from '@superone/shared/generative-ui/native-widgets'
import { BINARY_SNIFF_BYTES, fileKindFromName, looksBinary } from '@superone/shared/file-preview'
import { maxReadableBytes } from '../file-read-limits'
import { isMediaPathReadable } from '../media-readable-roots'
import { isPathWithinAllowed, resolveRealPath } from '../path-security'

export interface FilesPreviewerDeps {
  /** The session's working directory (its worktree when it has one), never the project identity. */
  root: string
  /** Injectable for tests; production reads the real filesystem. */
  fs?: FilesPreviewerFs
  isReadable?: (path: string) => boolean
}

export interface FilesPreviewerFs {
  exists: (path: string) => boolean
  stat: (path: string) => { size: number; isFile: boolean }
  /** First `BINARY_SNIFF_BYTES` of the file. */
  head: (path: string) => Uint8Array
  realpath: (path: string) => string
}

const realFs: FilesPreviewerFs = {
  exists: existsSync,
  stat: (path) => {
    const st = statSync(path)
    return { size: st.size, isFile: st.isFile() }
  },
  head: (path) => {
    const fd = openSync(path, 'r')
    try {
      const buf = new Uint8Array(BINARY_SNIFF_BYTES)
      const n = readSync(fd, buf, 0, BINARY_SNIFF_BYTES, 0)
      return buf.subarray(0, n)
    } finally {
      closeSync(fd)
    }
  },
  realpath: resolveRealPath,
}

interface FileEntryInput {
  path?: unknown
  note?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function unpreviewable(base: Omit<PreviewerFile, 'kind'>, reason: PreviewerUnpreviewableReason): PreviewerFile {
  return { ...base, kind: 'unpreviewable', reason }
}

/** Validate the agent's list before touching the disk, so a bad entry costs no I/O. */
function validateEntries(files: unknown): { entries?: { path: string; note?: string }[]; error?: string } {
  if (!Array.isArray(files) || files.length === 0) {
    return { error: '[Error] widget_show with @native/files-previewer requires a non-empty `data.files` array of { path, note? }.' }
  }
  if (files.length > FILES_PREVIEWER_MAX_FILES) {
    return { error: `[Error] data.files lists ${files.length} files; the previewer shows at most ${FILES_PREVIEWER_MAX_FILES}. Split them across calls.` }
  }
  const entries: { path: string; note?: string }[] = []
  for (const [index, raw] of files.entries()) {
    const entry = (asRecord(raw) ?? {}) as FileEntryInput
    const at = `files[${index}]`
    if (typeof entry.path !== 'string' || !entry.path.trim()) {
      return { error: `[Error] ${at}.path must be a non-empty string.` }
    }
    const note = typeof entry.note === 'string' ? entry.note.trim() : ''
    if (note.length > FILES_PREVIEWER_MAX_NOTE_CHARS) {
      return { error: `[Error] ${at}.note is ${note.length} characters; keep notes under ${FILES_PREVIEWER_MAX_NOTE_CHARS}.` }
    }
    entries.push({ path: entry.path.trim(), ...(note ? { note } : {}) })
  }
  return { entries }
}

/**
 * Kind + size verdict for a file whose bytes may live on another machine.
 * `sniffHead` returns the first bytes for a text-class file (to reject a binary
 * mislabelled `.txt`); a remote resolver that cannot cheaply read them omits it
 * and trusts the extension — the renderer's read still returns `binary` if wrong.
 */
export function classifyPreviewerFile(
  base: Omit<PreviewerFile, 'kind'>,
  size: number,
  sniffHead?: () => Uint8Array,
): PreviewerFile {
  const withSize = { ...base, size }
  const kind: PreviewerFileKind = fileKindFromName(base.name)
  if (kind === 'image' || kind === 'pdf' || kind === 'video' || kind === 'audio') return { ...withSize, kind }
  const ext = base.name.includes('.') ? base.name.slice(base.name.lastIndexOf('.')) : ''
  if (size > maxReadableBytes(ext)) return unpreviewable(withSize, 'too_large')
  if (kind === 'text' && sniffHead && looksBinary(sniffHead())) return unpreviewable(withSize, 'binary')
  return { ...withSize, kind }
}

/**
 * One row. Order and count always match the agent's list: a file that cannot be shown is a row
 * that says why, never a silent drop.
 */
function resolveFile(
  entry: { path: string; note?: string },
  deps: Required<Pick<FilesPreviewerDeps, 'root' | 'fs' | 'isReadable'>>,
): PreviewerFile {
  const { root, fs, isReadable } = deps
  const isAbs = isAbsolute(entry.path) || /^[A-Za-z]:[\\/]/.test(entry.path)
  const joined = isAbs ? entry.path : join(root, entry.path)
  const name = basename(joined)
  const base: Omit<PreviewerFile, 'kind'> = {
    path: entry.path,
    absolutePath: resolve(joined),
    name,
    ...(entry.note ? { note: entry.note } : {}),
  }

  if (!fs.exists(joined)) return { ...base, kind: 'missing' }
  const absolutePath = fs.realpath(joined)
  const resolved = { ...base, absolutePath }

  // A relative path is sandboxed to the root exactly as `readProjectFile` sandboxes it.
  if (!isAbs && !isPathWithinAllowed(absolutePath, [root])) return unpreviewable(resolved, 'outside_readable_roots')
  // An absolute path anywhere is fine to stat, but the media server only streams from its roots;
  // a `<video>` that would 403 is an error the agent can act on now, not a broken tile later.
  if (isAbs && !isPathWithinAllowed(absolutePath, [root]) && !isReadable(absolutePath)) {
    return unpreviewable(resolved, 'outside_readable_roots')
  }

  const st = fs.stat(absolutePath)
  if (!st.isFile) return { ...base, kind: 'missing' }
  // Text-class kinds get the host's own verdict: the same size cap the panel applies and a NUL
  // sniff, because `.txt` and `.log` can be anything.
  return classifyPreviewerFile(resolved, st.size, () => fs.head(absolutePath))
}

/** One file's verdict on its own — what the card's retry asks for after `missing`. */
export function resolvePreviewerFile(entry: { path: string; note?: string }, deps: FilesPreviewerDeps): PreviewerFile {
  return resolveFile(entry, {
    root: deps.root,
    fs: deps.fs ?? realFs,
    isReadable: deps.isReadable ?? isMediaPathReadable,
  })
}

export interface PreviewerBuildContext {
  /** Root every `absolutePath` was resolved against: a local dir, or a `remote:<conn>:<path>` key. */
  root: string
  /** One resolver per file — local reads disk synchronously, remote stats over RPC. */
  resolveOne: (entry: { path: string; note?: string }) => PreviewerFile | Promise<PreviewerFile>
}

export async function buildFilesPreviewerPayload(
  title: string,
  data: Record<string, unknown> | undefined,
  ctx: PreviewerBuildContext | FilesPreviewerDeps,
): Promise<{ payload?: NativeWidgetPayload; error?: string }> {
  const { entries, error } = validateEntries(data?.files)
  if (!entries) return { error }
  const build: PreviewerBuildContext =
    'resolveOne' in ctx ? ctx : { root: ctx.root, resolveOne: (entry) => resolvePreviewerFile(entry, ctx) }
  const files = await Promise.all(entries.map((entry) => build.resolveOne(entry)))
  return { payload: { kind: 'native', nativeType: 'files-previewer', title, root: build.root, files } }
}

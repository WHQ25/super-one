import { useCallback, useEffect, useState } from 'react'
import type { PreviewerFile, PreviewerFileKind } from '@superone/shared/generative-ui/native-widgets'
import { localFileUrlToPath, toLocalFileUrl, toMediaUrl } from '@/lib/path-utils'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { resolveDisplayMediaSrc, resolveMediaSrcForProject } from '@/lib/remote-media-url'

/**
 * What the stage needs for one slide. The host already decided `kind`, so the
 * loader only has to fetch what that kind consumes: text-class kinds read their
 * bytes over IPC, media kinds get a URL and load when the element mounts, and
 * verdict kinds (`missing`, `unpreviewable`) have nothing to load at all.
 */
export type PreviewerLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; content?: string; url?: string }
  | { status: 'error'; error: PreviewerLoadError }

export type PreviewerLoadError = 'missing' | 'binary' | 'too_large' | 'outside' | 'undecodable' | 'io'

const TEXT_KINDS: ReadonlySet<PreviewerFileKind> = new Set(['text', 'markdown', 'notebook'])

function mediaUrl(file: PreviewerFile): string {
  // A `data:` "path" never comes from the host; it is how stories and fixtures
  // feed the stage without a media server.
  if (file.absolutePath.startsWith('data:')) return file.absolutePath
  // Video and audio stream from the media server (range requests); everything
  // else is a whole-file fetch the local-file protocol serves fine.
  return file.kind === 'video' || file.kind === 'audio' || file.kind === 'model' ? toMediaUrl(file.absolutePath) : toLocalFileUrl(file.absolutePath)
}

/**
 * A node-session media file has no desktop file:// path; resolve it through
 * the same remote-media path the markdown images use — readProjectFile ->
 * resolveSessionFile -> a data URI, or the mirror's local-file URL for
 * session-zone media (inline-files-previewer.md §4.3).
 */
function isRemoteMedia(root: string, file: PreviewerFile): boolean {
  return !!parseRemoteProjectKey(root) && !file.absolutePath.startsWith('data:')
}

async function resolveRemoteMediaUrl(root: string, file: PreviewerFile): Promise<string | null> {
  const resolved = await resolveDisplayMediaSrc(resolveMediaSrcForProject(file.absolutePath, root))
  if (!resolved) return null
  // Zone media comes back as its mirror's local-file URL: from here on
  // it is a local file, and streams the way one does.
  const mirror = localFileUrlToPath(resolved)
  return mirror ? mediaUrl({ ...file, absolutePath: mirror }) : resolved
}

/** The URL a media-class slide loads from; `null` when a remote file cannot be resolved. */
export function resolvePreviewerMediaUrl(root: string, file: PreviewerFile): Promise<string | null> {
  return isRemoteMedia(root, file) ? resolveRemoteMediaUrl(root, file) : Promise.resolve(mediaUrl(file))
}

function languageToError(language: string): PreviewerLoadError | null {
  if (language === 'binary') return 'binary'
  if (language === 'too-large') return 'too_large'
  return null
}

export function usePreviewerFile(root: string, file: PreviewerFile, active: boolean): {
  state: PreviewerLoadState
  /** Flip a media slide into the error state when its element cannot decode the bytes. */
  markUndecodable: () => void
  /** Re-run the host's verdict; the answer replaces `file` upstream when it changed. */
  restat: () => Promise<PreviewerFile>
} {
  const [state, setState] = useState<PreviewerLoadState>({ status: 'idle' })
  const key = `${root}\0${file.absolutePath}\0${file.kind}`

  useEffect(() => {
    if (!active) { setState({ status: 'idle' }); return }
    if (file.kind === 'missing') { setState({ status: 'error', error: 'missing' }); return }
    if (file.kind === 'unpreviewable') {
      setState({ status: 'error', error: file.reason === 'binary' ? 'binary' : file.reason === 'too_large' ? 'too_large' : 'outside' })
      return
    }
    if (!TEXT_KINDS.has(file.kind)) {
      if (isRemoteMedia(root, file)) {
        let cancelled = false
        setState({ status: 'loading' })
        void resolveRemoteMediaUrl(root, file).then((url) => {
          if (cancelled) return
          setState(url ? { status: 'ready', url } : { status: 'error', error: 'io' })
        }).catch(() => { if (!cancelled) setState({ status: 'error', error: 'io' }) })
        return () => { cancelled = true }
      }
      setState({ status: 'ready', url: mediaUrl(file) })
      return
    }

    let cancelled = false
    setState({ status: 'loading' })
    window.app.readProjectFile(root, file.absolutePath).then((result) => {
      if (cancelled) return
      if (result.error) { setState({ status: 'error', error: 'io' }); return }
      const verdict = languageToError(result.language)
      if (verdict) { setState({ status: 'error', error: verdict }); return }
      setState({ status: 'ready', content: result.content })
    }).catch(() => {
      if (!cancelled) setState({ status: 'error', error: 'io' })
    })
    return () => { cancelled = true }
    // `key` folds root, path and kind; a retry that changes the kind re-runs this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, active])

  const markUndecodable = useCallback(() => setState({ status: 'error', error: 'undecodable' }), [])
  // Re-stat by absolute path: a remote root has no live cwd to resolve a
  // relative `path` against, and the absolute one is what the builder decided.
  // The label and note are the agent's and survive the answer.
  const restat = useCallback(async () => {
    const next = await window.app.statPreviewFile(root, file.absolutePath)
    return { ...next, path: file.path, ...(file.note ? { note: file.note } : {}) }
  }, [root, file.absolutePath, file.path, file.note])

  return { state, markUndecodable, restat }
}

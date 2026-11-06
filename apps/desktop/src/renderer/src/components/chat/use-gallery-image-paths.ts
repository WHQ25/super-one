import { useEffect, useState } from 'react'
import type { ImageGenerationItem } from '@superone/shared/agent-types'
import { parseRemoteProjectKey } from '@/lib/remote-project-key'
import { localFileUrlToPath } from '@/lib/path-utils'

/** Resolve node images to desktop mirrors or project cache files before native file actions use them. */
export function useGalleryImagePaths(items: ImageGenerationItem[], projectPath?: string | null): ImageGenerationItem[] {
  const remote = projectPath && parseRemoteProjectKey(projectPath)
  // Text streaming changes the items array too. Fetch only when file identities
  // or generation states change, rather than on every unrelated text delta.
  const key = JSON.stringify(items.map(item => [item.status, item.savedPath, item.previewPath]))
  const [resolved, setResolved] = useState<{ key: string; root: string; paths: Map<string, string | null> }>()

  useEffect(() => {
    if (!projectPath || !parseRemoteProjectKey(projectPath)) return
    let cancelled = false
    const entries = JSON.parse(key) as Array<[ImageGenerationItem['status'], string | null, string | null]>
    const paths = [...new Set(entries.flatMap(([status, ...files]) => status === 'failed' ? [] : files.filter((path): path is string => !!path)))]
    void Promise.all(paths.map(async path => {
      try {
        const file = await window.app.readProjectFile(projectPath, path)
        if (file.error) return [path, null] as const
        // Foreign paths never reach desktop file APIs. The host owns both
        // sync-zone mirroring and project-image caching.
        return [path, localFileUrlToPath(file.content)] as const
      } catch {
        return [path, null] as const
      }
    })).then(value => { if (!cancelled) setResolved({ key, root: projectPath, paths: new Map(value) }) })
    return () => { cancelled = true }
  }, [key, projectPath])

  if (!remote) return items
  const ready = resolved?.key === key && resolved.root === projectPath ? resolved.paths : null
  return items.map(item => {
    if (item.status === 'failed') return item
    // Never send a foreign path to the local media server while resolving it.
    if (!ready) return { ...item, savedPath: undefined, previewPath: undefined }
    const savedPath = item.savedPath ? ready.get(item.savedPath) : undefined
    const previewPath = item.previewPath ? ready.get(item.previewPath) : undefined
    if ((item.savedPath || item.previewPath) && !savedPath && !previewPath) return { ...item, status: 'failed' }
    return { ...item, savedPath: savedPath ?? undefined, previewPath: previewPath ?? undefined }
  })
}

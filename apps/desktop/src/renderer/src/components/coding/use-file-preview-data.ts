import { useEffect, useRef, useState } from 'react'
import type { GitFileContent, GitFileDiff } from '@superone/shared/agent-types'
import {
  AUDIO_EXTENSIONS,
  BINARY_IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  MODEL_EXTENSIONS,
  NOTEBOOK_EXTENSIONS,
  PDF_EXTENSIONS,
  VIDEO_EXTENSIONS,
  officePreviewKind,
} from '@superone/shared/file-preview'
import { useEffectiveProjectRoot } from '@/stores/app'

export type PreviewTabKey = 'preview' | 'file'

export function getFileExt(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot < 0 ? '' : fileName.slice(dot).toLowerCase()
}

function isBinaryPreviewPath(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? ''
  const ext = getFileExt(fileName)
  return (
    BINARY_IMAGE_EXTENSIONS.has(ext) ||
    PDF_EXTENSIONS.has(ext) ||
    VIDEO_EXTENSIONS.has(ext) ||
    AUDIO_EXTENSIONS.has(ext) ||
    MODEL_EXTENSIONS.has(ext) ||
    officePreviewKind(fileName) !== null
  )
}

export function useOwnFileData(filePath: string | undefined, refreshKey: number, root?: string) {
  const projectRoot = useEffectiveProjectRoot()
  const fileRoot = root ?? projectRoot
  const targetKey = `${fileRoot ?? ''}::${filePath ?? ''}`
  const [loaded, setLoaded] = useState<{ key: string; diff: GitFileDiff | null; content: GitFileContent | null }>({
    key: '',
    diff: null,
    content: null,
  })
  const [tab, setTab] = useState<PreviewTabKey>('file')
  const pickedTabForPathRef = useRef<string | null>(null)

  useEffect(() => {
    if (!filePath || !fileRoot) return
    let cancelled = false

    window.app
      .readProjectFile(fileRoot, filePath)
      .then((c) => {
        if (cancelled) return
        setLoaded((prev) => ({
          key: targetKey,
          diff: prev.key === targetKey ? prev.diff : null,
          content: c,
        }))
        if (c.error) return
        if (pickedTabForPathRef.current === targetKey) return
        pickedTabForPathRef.current = targetKey
        const isBin =
          c.language === 'image' ||
          c.language === 'pdf' ||
          c.language === 'video' ||
          c.language === 'audio' ||
          c.language === 'model' ||
          c.language === 'office'
        const isSvg = c.language === 'svg'
        const ext = getFileExt(filePath)
        const isMd = MARKDOWN_EXTENSIONS.has(ext)
        const isNb = NOTEBOOK_EXTENSIONS.has(ext)
        setTab(isBin || isSvg || isMd || isNb ? 'preview' : 'file')
      })
      .catch(() => {
        if (!cancelled && pickedTabForPathRef.current !== targetKey) {
          setLoaded({ key: targetKey, diff: null, content: null })
        }
      })

    if (!isBinaryPreviewPath(filePath)) {
      window.app
        .getGitDiffFile(fileRoot, filePath, false)
        .then((d) => {
          if (cancelled) return
          setLoaded((prev) => ({
            key: targetKey,
            diff: d,
            content: prev.key === targetKey ? prev.content : null,
          }))
        })
        .catch(() => {})
    }

    return () => {
      cancelled = true
    }
  }, [filePath, fileRoot, refreshKey, targetKey])

  const isCurrent = loaded.key === targetKey
  return { diff: isCurrent ? loaded.diff : null, content: isCurrent ? loaded.content : null, tab, setTab }
}

import { AtSign, Copy, FolderOpen, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { chatInputAPI } from '@/components/chat/chat-input-api'
import { toMentionPath } from '@/components/chat/chat-input-utils'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { isAbsoluteLocalPath, isHtmlFilePath, toProjectRelativePath } from '@/lib/file-link'
import { toLocalFileUrl } from '@/lib/path-utils'
import { displayHostPath } from '@/lib/remote-project-key'

/**
 * Host-absolute path for a chip. Remote projects are keyed as
 * `remote:<connectionId>:<hostPath>`, so the root has to be unwrapped before it
 * is joined — otherwise the key prefix leaks into file URLs and the clipboard.
 */
function absoluteFilePath(filePath: string, projectRoot: string | null | undefined): string {
  if (isAbsoluteLocalPath(filePath)) return filePath
  const root = projectRoot ? displayHostPath(projectRoot).replace(/[/\\]+$/, '') : ''
  return root ? `${root}/${filePath.replace(/^\.\//, '')}` : filePath
}

export function useFileChipContextMenu(filePath: string | undefined, name: string): AdaptiveMenuEntry[] {
  const { t } = useTranslation()
  if (!filePath) return []

  const handleOpenFolder = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const openPath = toProjectRelativePath(filePath, projectRoot)
    if (openPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(openPath)) {
      void window.app.showInFolder(projectRoot ?? openPath, openPath)
      return
    }
    if (!projectRoot) return
    void window.app.showInFolder(projectRoot, openPath)
  }

  const handleAddToChat = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    chatInputAPI.insertMention?.('file', toMentionPath(filePath, projectRoot), name)
  }

  const handleCopyPath = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    void navigator.clipboard.writeText(absoluteFilePath(filePath, projectRoot))
  }

  const handleCopyRelativePath = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    void navigator.clipboard.writeText(toProjectRelativePath(filePath, projectRoot))
  }

  const handlePreviewInBrowser = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    openBrowserTab(toLocalFileUrl(absoluteFilePath(filePath, projectRoot)))
  }

  return [
    { kind: 'item', id: 'openFolder', label: t('sidebar.contextMenu.openFolder'), icon: FolderOpen, onSelect: handleOpenFolder },
    { kind: 'item', id: 'addToChat', label: t('sidebar.contextMenu.addToChat'), icon: AtSign, onSelect: handleAddToChat },
    ...(isHtmlFilePath(filePath)
      ? [{
          kind: 'item' as const,
          id: 'previewInBrowser',
          label: t('sidebar.contextMenu.previewInBrowser'),
          icon: Globe,
          onSelect: handlePreviewInBrowser,
        }]
      : []),
    { kind: 'item', id: 'copyPath', label: t('sidebar.contextMenu.copyPath'), icon: Copy, onSelect: handleCopyPath },
    { kind: 'item', id: 'copyRelativePath', label: t('sidebar.contextMenu.copyRelativePath'), icon: Copy, onSelect: handleCopyRelativePath },
  ]
}

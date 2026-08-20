import { AtSign, FolderOpen, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AdaptiveMenuEntry } from '@/lib/native-context-menu'
import { openBrowserTab } from '@/components/activity/activity-panel-api'
import { chatInputAPI } from '@/components/chat/chat-input-api'
import { toMentionPath } from '@/components/chat/chat-input-utils'
import { useAppStore, selectEffectiveProjectRoot } from '@/stores/app'
import { isAbsoluteLocalPath, isHtmlFilePath } from '@/lib/file-link'
import { toLocalFileUrl } from '@/lib/path-utils'

function pathForOpen(filePath: string, projectPath: string | null | undefined): string {
  if (projectPath && filePath.startsWith(projectPath + '/')) {
    return filePath.slice(projectPath.length + 1)
  }
  return filePath
}

function absoluteFilePath(filePath: string, projectRoot: string | null | undefined): string {
  if (isAbsoluteLocalPath(filePath)) return filePath
  return projectRoot ? `${projectRoot}/${filePath}` : filePath
}

export function useFileChipContextMenu(filePath: string | undefined, name: string): AdaptiveMenuEntry[] {
  const { t } = useTranslation()
  if (!filePath) return []

  const handleOpenFolder = (): void => {
    const projectRoot = selectEffectiveProjectRoot(useAppStore.getState())
    const openPath = pathForOpen(filePath, projectRoot)
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
  ]
}

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { useExplorerStore } from '@/stores/explorer'

export function useGitAutoRefresh() {
  const status = useActiveSession((s) => s.status)
  const showFilePanel = useAppStore((s) => s.showFilePanel)
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const currentFolder = useAppStore((s) => s.currentFolder)
  const prevStatusRef = useRef(status)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status

    if (!currentFolder) return

    const needsRefresh = showFilePanel || sidebarTab === 'explorer'
    if (!needsRefresh) return

    const shouldRefresh = prev === 'streaming' && status === 'idle'
    if (!shouldRefresh) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (showFilePanel) useSourceControlStore.getState().refresh(currentFolder)
      if (sidebarTab === 'explorer') useExplorerStore.getState().fetchTree(currentFolder)
    }, 500)

    return () => clearTimeout(debounceRef.current)
  }, [status, showFilePanel, sidebarTab, currentFolder])

  useEffect(() => {
    if (showFilePanel && currentFolder) {
      useSourceControlStore.getState().fetchFiles(currentFolder)
    }
  }, [showFilePanel, currentFolder])
}

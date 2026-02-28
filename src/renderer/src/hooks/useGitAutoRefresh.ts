import { useEffect, useRef } from 'react'
import { useAppStore } from '@/stores/app'
import { useActiveSession } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { useFileTreeStore } from '@/stores/file-tree'

export function GitAutoRefresh() {
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

    const needsRefresh = showFilePanel || sidebarTab === 'files'
    if (!needsRefresh) return

    const shouldRefresh = prev === 'streaming' && status === 'idle'
    if (!shouldRefresh) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (showFilePanel) useSourceControlStore.getState().refresh(currentFolder)
      if (sidebarTab === 'files') useFileTreeStore.getState().refreshTree(currentFolder)
    }, 500)

    return () => clearTimeout(debounceRef.current)
  }, [status, showFilePanel, sidebarTab, currentFolder])

  useEffect(() => {
    if (showFilePanel && currentFolder) {
      useSourceControlStore.getState().fetchFiles(currentFolder)
    }
  }, [showFilePanel, currentFolder])

  useEffect(() => {
    if (sidebarTab === 'files' && currentFolder) {
      useFileTreeStore.getState().refreshTree(currentFolder)
    }
  }, [sidebarTab, currentFolder])

  const needsWatch = showFilePanel || sidebarTab === 'files'

  useEffect(() => {
    if (!currentFolder || !needsWatch) {
      window.app.stopFileWatch()
      return
    }

    window.app.startFileWatch(currentFolder)

    const scheduleRefresh = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const folder = useAppStore.getState().currentFolder
        if (!folder) return
        const { showFilePanel: fp, sidebarTab: tab } = useAppStore.getState()
        if (fp) useSourceControlStore.getState().refresh(folder)
        if (tab === 'files') useFileTreeStore.getState().refreshTree(folder)
      }, 500)
    }

    const unsubFile = window.app.onFileChangeEvent(scheduleRefresh)
    const unsubHead = window.app.onGitHeadChange(scheduleRefresh)

    return () => {
      unsubFile()
      unsubHead()
      window.app.stopFileWatch()
    }
  }, [currentFolder, needsWatch])

  return null
}

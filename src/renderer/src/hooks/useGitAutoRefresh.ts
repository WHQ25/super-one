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
  const wtActivePath = useAppStore((s) => currentFolder ? s._worktrees[currentFolder]?.activePath : null)
  const fileRoot = wtActivePath ?? currentFolder
  const prevStatusRef = useRef(status)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status

    if (!fileRoot) return

    const needsRefresh = showFilePanel || sidebarTab === 'files'
    if (!needsRefresh) return

    const shouldRefresh = prev === 'streaming' && status === 'idle'
    if (!shouldRefresh) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (showFilePanel) useSourceControlStore.getState().refresh(fileRoot)
      if (sidebarTab === 'files') useFileTreeStore.getState().refreshTree(fileRoot)
    }, 500)

    return () => clearTimeout(debounceRef.current)
  }, [status, showFilePanel, sidebarTab, fileRoot])

  useEffect(() => {
    if (showFilePanel && fileRoot) {
      useSourceControlStore.getState().fetchFiles(fileRoot)
    }
  }, [showFilePanel, fileRoot])

  useEffect(() => {
    if (sidebarTab === 'files' && fileRoot) {
      useFileTreeStore.getState().refreshTree(fileRoot)
    }
  }, [sidebarTab, fileRoot])

  const needsWatch = showFilePanel || sidebarTab === 'files'

  useEffect(() => {
    if (!fileRoot || !needsWatch) {
      window.app.stopFileWatch()
      return
    }

    window.app.startFileWatch(fileRoot)

    const scheduleRefresh = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const { currentFolder: cf, _worktrees: wts } = useAppStore.getState()
        const root = cf ? (wts[cf]?.activePath ?? cf) : null
        if (!root) return
        const { showFilePanel: fp, sidebarTab: tab } = useAppStore.getState()
        if (fp) useSourceControlStore.getState().refresh(root)
        if (tab === 'files') useFileTreeStore.getState().refreshTree(root)
      }, 500)
    }

    const unsubFile = window.app.onFileChangeEvent(scheduleRefresh)
    const unsubHead = window.app.onGitHeadChange(scheduleRefresh)

    return () => {
      unsubFile()
      unsubHead()
      window.app.stopFileWatch()
    }
  }, [fileRoot, needsWatch])

  return null
}

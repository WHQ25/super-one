import { useEffect, useRef } from 'react'
import { useAppStore, useEffectiveProjectRoot, selectEffectiveProjectRoot } from '@/stores/app'
import { useActivityPanelStore } from '@/stores/activity-panel'
import { useActiveSession } from '@/stores/chat'
import { useSourceControlStore } from '@/stores/source-control'
import { useFileTreeStore } from '@/stores/file-tree'
import { getDockApi } from '@/components/activity/activity-panel-api'

function hasFileTab() {
  const api = getDockApi()
  return api?.panels.some((p) => p.id.startsWith('file:')) ?? false
}

export function GitAutoRefresh() {
  const status = useActiveSession((s) => s.status)
  const showPanel = useActivityPanelStore((s) => s.showPanel)
  const sidebarTab = useAppStore((s) => s.sidebarTab)
  const fileRoot = useEffectiveProjectRoot()
  const prevStatusRef = useRef(status)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const fileTabActive = showPanel && hasFileTab()

  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status

    if (!fileRoot) return

    const needsRefresh = fileTabActive || sidebarTab === 'files'
    if (!needsRefresh) return

    const shouldRefresh = prev === 'streaming' && status === 'idle'
    if (!shouldRefresh) return

    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      if (fileTabActive) useSourceControlStore.getState().refresh(fileRoot)
      if (sidebarTab === 'files') useFileTreeStore.getState().refreshTree(fileRoot)
    }, 500)

    return () => clearTimeout(debounceRef.current)
  }, [status, fileTabActive, sidebarTab, fileRoot])

  useEffect(() => {
    if (fileTabActive && fileRoot) {
      useSourceControlStore.getState().fetchFiles(fileRoot)
    }
  }, [fileTabActive, fileRoot])

  useEffect(() => {
    if (sidebarTab === 'files' && fileRoot) {
      useFileTreeStore.getState().refreshTree(fileRoot)
    }
  }, [sidebarTab, fileRoot])

  const needsWatch = fileTabActive || sidebarTab === 'files'

  useEffect(() => {
    if (!fileRoot || !needsWatch) {
      window.app.stopFileWatch()
      return
    }

    window.app.startFileWatch(fileRoot)

    const scheduleRefresh = () => {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const root = selectEffectiveProjectRoot(useAppStore.getState())
        if (!root) return
        const ap = useActivityPanelStore.getState()
        const ft = ap.showPanel && hasFileTab()
        const tab = useAppStore.getState().sidebarTab
        if (ft) useSourceControlStore.getState().refresh(root)
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

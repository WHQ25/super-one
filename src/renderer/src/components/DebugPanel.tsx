import { useState, useEffect, useCallback } from 'react'
import { Bug, X } from 'lucide-react'
import { useMiniAppStore } from '@/stores/miniapp'
import type { MiniAppPreviewResult } from '../../../shared/miniapp-types'

interface DebugTrigger {
  id: string
  label: string
  description?: string
  action: () => void
}

const MOCK_INSTALL_FULL: MiniAppPreviewResult = {
  manifest: {
    appId: 'debug-test-app',
    name: 'Debug Test App',
    version: '2.0.0',
    author: { name: 'Debug', url: 'https://example.com' },
    description: 'A mock app for testing the install permission dialog',
    permissions: {
      fs: [
        { scope: 'project', path: '.', access: 'readwrite', reason: 'Manage project configuration and generated files' },
        { scope: 'project', path: 'src', access: 'read', reason: 'Analyze source code structure for diagnostics' },
        { scope: 'user', path: '.config/debug-app', access: 'readwrite', reason: 'Store user preferences and cached data' },
        { scope: 'app', reason: 'Persist internal app state between sessions' },
      ],
      network: [
        { domain: 'api.github.com', reason: 'Fetch repository metadata and issue tracking data' },
        { domain: 'cdn.example.com', reason: 'Download static assets and UI resources' },
      ],
    },
  },
  tempDir: '/tmp/debug-mock',
}

const MOCK_INSTALL_UPGRADE: MiniAppPreviewResult = {
  manifest: {
    ...MOCK_INSTALL_FULL.manifest,
    name: 'Debug Upgrade App',
  },
  tempDir: '/tmp/debug-mock',
  existingVersion: '1.0.0',
}

const MOCK_INSTALL_NO_PERMS: MiniAppPreviewResult = {
  manifest: {
    appId: 'debug-no-perms',
    name: 'Simple Widget',
    version: '1.0.0',
    description: 'An app with no special permissions',
  },
  tempDir: '/tmp/debug-mock',
}

const DEBUG_TRIGGERS: DebugTrigger[] = [
  {
    id: 'install-dialog',
    label: 'Install Dialog',
    description: 'fs + network permissions',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_FULL }),
  },
  {
    id: 'install-dialog-upgrade',
    label: 'Install Dialog (Upgrade)',
    description: 'Version 1.0.0 → 2.0.0',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_UPGRADE }),
  },
  {
    id: 'install-dialog-no-perms',
    label: 'Install Dialog (No Perms)',
    description: 'No permissions declared',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_NO_PERMS }),
  },
]

export function DebugPanel() {
  const [expanded, setExpanded] = useState(false)

  const toggle = useCallback(() => setExpanded((v) => !v), [])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'd') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  if (!expanded) {
    return (
      <button
        onClick={toggle}
        className="fixed bottom-3 right-3 z-[9999] flex items-center gap-1 rounded-full bg-orange-500 px-2.5 py-1 text-[11px] font-medium text-white shadow-lg transition-opacity hover:opacity-90"
      >
        <Bug className="size-3" />
        Debug
      </button>
    )
  }

  return (
    <div className="fixed bottom-3 right-3 z-[9999] w-72 rounded-lg border bg-background/95 shadow-xl backdrop-blur-sm">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Bug className="size-3.5 text-orange-500" />
          Debug Panel
        </span>
        <button onClick={toggle} className="rounded p-0.5 hover:bg-muted">
          <X className="size-3.5 text-muted-foreground" />
        </button>
      </div>
      <div className="flex flex-col gap-1 p-2">
        {DEBUG_TRIGGERS.map((trigger) => (
          <button
            key={trigger.id}
            onClick={trigger.action}
            className="rounded-md border px-3 py-2 text-left transition-colors hover:bg-muted"
          >
            <div className="text-xs font-medium">{trigger.label}</div>
            {trigger.description && (
              <div className="text-[11px] text-muted-foreground">{trigger.description}</div>
            )}
          </button>
        ))}
      </div>
      <div className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
        ⌘⇧D to toggle
      </div>
    </div>
  )
}

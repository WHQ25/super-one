import { useState, useEffect, useCallback } from 'react'
import { Bug, X } from 'lucide-react'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { useMiniAppStore } from '@/stores/miniapp'
import { useDevToolsStore } from '@/stores/dev-tools'
import type { MiniAppPreviewResult } from '@superone/shared/miniapp-types'

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

const MOCK_INSTALL_WITH_TOOLS: MiniAppPreviewResult = {
  manifest: {
    ...MOCK_INSTALL_FULL.manifest,
    appId: 'debug-tools-app',
    name: 'Debug Tools App',
    description: 'An app with both permissions and tools for preapproval testing',
    toolSlug: 'debug_tools',
    tools: [
      { name: 'analyze', description: 'Analyze project files and generate insights', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
      { name: 'render_chart', description: 'Render data as interactive charts', inputSchema: { type: 'object', properties: { data: { type: 'array' } } } },
      { name: 'export_report', description: 'Export analysis results to various formats', inputSchema: { type: 'object', properties: { format: { type: 'string' } } } },
    ],
  },
  tempDir: '/tmp/debug-mock',
}

const MOCK_INSTALL_TOOLS_ONLY: MiniAppPreviewResult = {
  manifest: {
    appId: 'debug-tools-only',
    name: 'Tools Only App',
    version: '1.0.0',
    description: 'An app with tools but no fs/network permissions',
    toolSlug: 'tools_only',
    tools: [
      { name: 'process', description: 'Process input data and return results', inputSchema: { type: 'object', properties: { input: { type: 'string' } } } },
      { name: 'summarize', description: 'Summarize content into key points', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } },
    ],
  },
  tempDir: '/tmp/debug-mock',
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

const MOCK_INSTALL_MEDIA: MiniAppPreviewResult = {
  manifest: {
    appId: 'debug-media-app',
    name: 'Voice Notes Pro',
    version: '1.2.0',
    author: { name: 'SuperOne Demos', url: 'https://example.com' },
    description: 'Records voice memos and captures snapshots',
    permissions: {
      fs: [
        { scope: 'app', reason: 'Persist recordings and snapshots between sessions' },
      ],
      media: [
        { kind: 'microphone', reason: 'Record voice memos and dictation' },
        { kind: 'camera', reason: 'Take profile photos and document scans' },
      ],
    },
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
    id: 'install-dialog-tools',
    label: 'Install Dialog (Perms + Tools)',
    description: 'Permissions + tool preapproval tabs',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_WITH_TOOLS }),
  },
  {
    id: 'install-dialog-tools-only',
    label: 'Install Dialog (Tools Only)',
    description: 'Tools only, no fs/network permissions',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_TOOLS_ONLY }),
  },
  {
    id: 'install-dialog-no-perms',
    label: 'Install Dialog (No Perms)',
    description: 'No permissions declared',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_NO_PERMS }),
  },
  {
    id: 'install-dialog-media',
    label: 'Install Dialog (Media)',
    description: 'Mic + camera permissions',
    action: () => useMiniAppStore.setState({ pendingInstall: MOCK_INSTALL_MEDIA }),
  },
]

export function DebugPanel() {
  const [expanded, setExpanded] = useState(false)
  const reactScan = useDevToolsStore((s) => s.reactScan)
  const toggleReactScan = useDevToolsStore((s) => s.toggleReactScan)

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
        <IconButton size="sm" onClick={toggle}>
          <X />
        </IconButton>
      </div>
      <div className="flex flex-col gap-1 border-b p-2">
        <ToggleRow label="React Scan" active={reactScan} onToggle={toggleReactScan} />
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

function ToggleRow({ label, active, onToggle }: { label: string; active: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between rounded-md border px-3 py-1.5 text-left transition-colors hover:bg-muted"
    >
      <span className="text-xs font-medium">{label}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${active ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground'}`}>
        {active ? 'ON' : 'OFF'}
      </span>
    </button>
  )
}

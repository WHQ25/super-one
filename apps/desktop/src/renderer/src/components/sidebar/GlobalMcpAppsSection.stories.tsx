import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Blocks } from 'lucide-react'
import { mcpAppEntrypointKey, type McpAppEntrypointDescriptor } from '@superone/shared/mcp-app-entrypoints'
import { GlobalMcpAppsList } from './GlobalMcpAppsSection'

const SAMPLE_ENTRYPOINTS: McpAppEntrypointDescriptor[] = [
  {
    key: mcpAppEntrypointKey('claude', 'linear', 'open_board'),
    server: 'linear',
    tool: 'open_board',
    title: 'Sprint Board',
    serverTitle: 'Linear',
    description: 'Triage and reprioritize sprint issues across teams',
    resourceUri: 'ui://linear/board.html',
    harness: 'claude',
    kinds: ['global', 'thread'],
  },
  {
    key: mcpAppEntrypointKey('codex', 'bits', 'cad.library'),
    server: 'bits',
    tool: 'cad.library',
    title: '3D CAD Library',
    serverTitle: 'Bits & Bolts',
    description: 'Browse parametric STL/STEP parts and sync selections to chat',
    resourceUri: 'ui://bits/library.html',
    harness: 'codex',
    kinds: ['global'],
  },
  {
    key: mcpAppEntrypointKey('claude', 'postgres', 'query_studio'),
    server: 'postgres',
    tool: 'query_studio',
    title: 'SQL Query Studio with Very Long Workspace Label',
    serverTitle: 'Postgres Explorer',
    description: 'Inspect schemas, explain plans, and export result sets safely',
    resourceUri: 'ui://postgres/studio.html',
    harness: 'claude',
    kinds: ['thread'],
  },
]

function InteractiveSidebarFrame({
  loading = false,
  incomplete = false,
  compact = false,
  divided = false,
  search = '',
  width = 280,
}: {
  loading?: boolean
  incomplete?: boolean
  compact?: boolean
  divided?: boolean
  search?: string
  width?: number
}) {
  const [lastAction, setLastAction] = useState<string>('Idle')
  const sorted = [...SAMPLE_ENTRYPOINTS].sort((a, b) => a.title.localeCompare(b.title))

  return (
    <div className="flex flex-col gap-3 p-6">
      <div
        style={{ width }}
        className="rounded-lg border border-sidebar-border bg-sidebar p-1.5 text-sidebar-foreground shadow-sm"
      >
        {divided && (
          <div className="flex flex-col pb-1">
            <div className="px-2 py-1 text-[11px] font-medium text-sidebar-foreground/50">
              Mini Apps
            </div>
            <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px]">
              <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-sidebar-hover/60">
                <Blocks className="size-3.5 text-muted-foreground" />
              </span>
              <span className="truncate">Notes Pad</span>
            </div>
          </div>
        )}
        <GlobalMcpAppsList
          entrypoints={sorted}
          loading={loading}
          incomplete={incomplete}
          compact={compact}
          divided={divided}
          search={search}
          onOpen={(item, maximized) => setLastAction(`Opened ${item.title} (${maximized ? 'maximized' : 'docked'})`)}
          onRefresh={() => setLastAction('Refreshed MCP Apps')}
        />
      </div>
      <p className="text-xs text-muted-foreground">Last action: {lastAction}</p>
    </div>
  )
}

const meta: Meta<typeof InteractiveSidebarFrame> = {
  title: 'Sidebar/GlobalMcpAppsSection',
  component: InteractiveSidebarFrame,
  parameters: { layout: 'fullscreen' },
}

export default meta
type Story = StoryObj<typeof InteractiveSidebarFrame>

export const AppDrawerGrouped: Story = {
  args: { compact: true, divided: true },
}

export const DiscoveredApps: Story = {
  args: {},
}

export const LoadingRefresh: Story = {
  args: { loading: true },
}

export const IncompleteServerWarning: Story = {
  args: { incomplete: true },
}

export const FilteredBySearch: Story = {
  args: { compact: true, divided: true, search: 'cad' },
}

export const NarrowCompactDrawer: Story = {
  args: { compact: true, width: 210 },
}

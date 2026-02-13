import { ArrowLeft, Blocks, Bot, Puzzle, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'
import { AgentsPage } from './AgentsPage'
import { SkillsPage } from './SkillsPage'
import { McpPage } from './McpPage'
import { PluginsPage } from './PluginsPage'
import { cn } from '@/lib/utils'

const tabs = [
  { id: 'agents' as const, label: 'Agents', icon: Bot },
  { id: 'skills' as const, label: 'Skills', icon: Puzzle },
  { id: 'mcp' as const, label: 'MCP Servers', icon: Server },
  { id: 'plugins' as const, label: 'Plugins', icon: Blocks },
]

export function SettingsLayout() {
  const settingsTab = useAppStore((s) => s.settingsTab)
  const setSettingsTab = useAppStore((s) => s.setSettingsTab)
  const navigateTo = useAppStore((s) => s.navigateTo)

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Sidebar */}
      <div className="flex w-64 shrink-0 flex-col border-r border-border bg-background p-3">
        <Button
          variant="ghost"
          size="sm"
          className="mb-4 justify-start"
          onClick={() => navigateTo('main')}
        >
          <ArrowLeft className="size-4" />
          Back
        </Button>

        <nav className="flex flex-col gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setSettingsTab(tab.id)}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                settingsTab === tab.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <tab.icon className="size-4" />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {settingsTab === 'agents' && <AgentsPage />}
        {settingsTab === 'skills' && <SkillsPage />}
        {settingsTab === 'mcp' && <McpPage />}
        {settingsTab === 'plugins' && <PluginsPage />}
      </div>
    </div>
  )
}

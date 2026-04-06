import { RefreshCw, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useChatStore } from '@/stores/chat'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import type { MiniAppEntry } from '../../../../shared/miniapp-types'

interface MiniAppBuilderProps {
  apps: MiniAppEntry[]
  onOpenApp: (entry: MiniAppEntry) => void
  onRefresh: () => void
}

export function MiniAppBuilder({ apps, onOpenApp, onRefresh }: MiniAppBuilderProps) {
  const openChatPanel = () => {
    const store = useChatStore.getState()
    if (!store.isOpen) store.toggleOpen()
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <h2 className="text-lg font-medium">Mini-Apps</h2>
      {apps.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No apps installed. Ask the agent to create one for you.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {apps.map((app) => (
            <button
              key={app.id}
              onClick={() => onOpenApp(app)}
              className="bg-card hover:bg-accent flex flex-col items-center gap-2 rounded-lg border p-4 transition-colors"
            >
              <MiniAppIcon appId={app.id} className={app.manifest.logo ? 'size-10' : 'size-8 text-muted-foreground'} />
              <span className="text-sm font-medium">{app.manifest.name}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={openChatPanel}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          New Mini-App
        </Button>
        <Button variant="ghost" size="sm" onClick={onRefresh}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>
    </div>
  )
}

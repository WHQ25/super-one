import { FolderOpen, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'

export function StartupPage(): React.JSX.Element {
  const { recentFolders, selectAndOpenFolder, openFolder, removeRecentFolder } = useAppStore()

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">SuperPM</h1>
        <p className="mt-2 text-muted-foreground">AI-Powered Product Design</p>
      </div>

      <Button size="lg" onClick={selectAndOpenFolder}>
        <FolderOpen className="size-5" />
        Open Project
      </Button>

      {recentFolders.length > 0 && (
        <div className="w-full max-w-md">
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">Projects</h2>
          <div className="rounded-lg border bg-card">
            {recentFolders.map((folder) => (
              <div
                key={folder.path}
                className="group flex cursor-pointer items-center gap-3 border-b px-4 py-3 last:border-b-0 hover:bg-muted/50"
                onClick={() => openFolder(folder.path)}
              >
                <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{folder.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{folder.path}</div>
                </div>
                <button
                  className="rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeRecentFolder(folder.path)
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

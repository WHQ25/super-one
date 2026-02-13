import { useEffect, useState, useCallback } from 'react'
import { GitBranch, ChevronDown, ShieldCheck, Check } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useActiveSession } from '@/stores/chat'
import { useAppStore } from '@/stores/app'
import { PermissionModeSelector } from './PermissionModeSelector'
import type { GitInfo } from '../../../../shared/agent-types'

export function ChatStatusBar() {
  const currentFolder = useAppStore((s) => s.currentFolder)
  const sandboxInfo = useActiveSession((s) => s.sandboxInfo)
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [branchOpen, setBranchOpen] = useState(false)

  useEffect(() => {
    if (!currentFolder) { setGitInfo(null); return }

    let cancelled = false
    const fetch = () => {
      window.app.getGitInfo(currentFolder).then((info) => {
        if (!cancelled) setGitInfo(info)
      })
    }
    fetch()
    const interval = setInterval(fetch, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [currentFolder])

  const loadBranches = useCallback(() => {
    if (!currentFolder) return
    window.app.getGitBranches(currentFolder).then(setBranches)
  }, [currentFolder])

  const switchBranch = useCallback(async (branch: string) => {
    if (!currentFolder || branch === gitInfo?.branch) return
    const ok = await window.app.switchGitBranch(currentFolder, branch)
    if (ok) setGitInfo({ branch })
  }, [currentFolder, gitInfo?.branch])

  return (
    <div className="flex items-center gap-2 px-7 pb-3 pt-1 text-[11px] text-muted-foreground">
      {/* Git branch switcher */}
      {gitInfo && (
        <DropdownMenu onOpenChange={(open) => { setBranchOpen(open); if (open) loadBranches() }}>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1 rounded-lg px-2 py-1 transition-colors hover:bg-muted hover:text-foreground">
              <GitBranch className="size-3" />
              <span>{gitInfo.branch}</span>
              <ChevronDown className={`size-3 transition-transform duration-200 ${branchOpen ? 'rotate-180' : ''}`} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-60 w-48 overflow-y-auto">
            {branches.map((b) => (
              <DropdownMenuItem
                key={b}
                onClick={() => switchBranch(b)}
                className="gap-2 text-xs"
              >
                {b === gitInfo.branch ? <Check className="size-3" /> : <div className="size-3" />}
                <span className="truncate">{b}</span>
              </DropdownMenuItem>
            ))}
            {branches.length === 0 && (
              <div className="px-2 py-1.5 text-xs text-muted-foreground">No branches</div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Sandbox status */}
      {sandboxInfo.enabled && (
        <>
          <div className="h-3 w-px bg-border" />
          <div
            className="flex items-center gap-1 text-emerald-400"
            title={sandboxInfo.autoAllowBash ? 'Sandbox enabled, Bash auto-allowed' : 'Sandbox enabled'}
          >
            <ShieldCheck className="size-3" />
            <span>Sandbox{sandboxInfo.autoAllowBash ? ' (Auto)' : ''}</span>
          </div>
        </>
      )}

      <div className="h-3 w-px bg-border" />

      {/* Permission mode */}
      <PermissionModeSelector />
    </div>
  )
}

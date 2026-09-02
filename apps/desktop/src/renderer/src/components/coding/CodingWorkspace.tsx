import { useLayoutEffect, useMemo, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { SessionMosaic } from '@/components/mosaic/SessionMosaic'
import { useChatStore, type SessionScope } from '@/stores/chat'
import { CodingLayout } from './CodingLayout'

interface CodingWorkspaceProps {
  mosaicMode: 'single' | 'mosaic'
  /** Mini shell hides auxiliary surfaces without remounting the active SessionPane. */
  compact?: boolean
}

export function CodingWorkspace({ mosaicMode, compact = false }: CodingWorkspaceProps) {
  const activeProject = useChatStore((s) => s.activeProject)
  const activeSessionId = useChatStore((s) => activeProject ? s.projectSessions[activeProject]?._activeSessionId ?? null : null)
  const activeScope = useMemo<SessionScope | undefined>(
    () => activeProject && activeSessionId ? { projectPath: activeProject, sessionId: activeSessionId } : undefined,
    [activeProject, activeSessionId],
  )
  // The mini shell is a single chat column wide: a mosaic cannot lay out in it, and
  // every tile carries its own maximize/close chrome that would sit right beside the
  // mini header's restore button. So the mini shell always shows the focused session
  // alone. The mosaic tree stays untouched in the store, which is what lets unfolding
  // back to the full window land in the grid the user left.
  const effectiveMode = compact ? 'single' : mosaicMode
  const [singleScope, setSingleScope] = useState(activeScope)
  useLayoutEffect(() => {
    if (effectiveMode === 'mosaic') return
    setSingleScope((current) =>
      current?.projectPath === activeScope?.projectPath && current?.sessionId === activeScope?.sessionId
        ? current
        : activeScope,
    )
  }, [effectiveMode, activeScope])

  return (
    <>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', effectiveMode === 'mosaic' && 'hidden')}>
        <CodingLayout foreground={effectiveMode !== 'mosaic'} scope={singleScope} compact={compact} />
      </div>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', effectiveMode !== 'mosaic' && 'hidden')}>
        <SessionMosaic foreground={effectiveMode === 'mosaic'} />
      </div>
    </>
  )
}

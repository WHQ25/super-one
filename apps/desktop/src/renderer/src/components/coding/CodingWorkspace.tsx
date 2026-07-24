import { useLayoutEffect, useMemo, useState } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { SessionMosaic } from '@/components/mosaic/SessionMosaic'
import { useChatStore, type SessionScope } from '@/stores/chat'
import { CodingLayout } from './CodingLayout'

interface CodingWorkspaceProps {
  mosaicMode: 'single' | 'mosaic'
}

export function CodingWorkspace({ mosaicMode }: CodingWorkspaceProps) {
  const activeProject = useChatStore((s) => s.activeProject)
  const activeSessionId = useChatStore((s) => activeProject ? s.projectSessions[activeProject]?._activeSessionId ?? null : null)
  const activeScope = useMemo<SessionScope | undefined>(
    () => activeProject && activeSessionId ? { projectPath: activeProject, sessionId: activeSessionId } : undefined,
    [activeProject, activeSessionId],
  )
  const [singleScope, setSingleScope] = useState(activeScope)
  useLayoutEffect(() => {
    if (mosaicMode === 'mosaic') return
    setSingleScope((current) =>
      current?.projectPath === activeScope?.projectPath && current?.sessionId === activeScope?.sessionId
        ? current
        : activeScope,
    )
  }, [mosaicMode, activeScope])

  return (
    <>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mosaicMode === 'mosaic' && 'hidden')}>
        <CodingLayout foreground={mosaicMode !== 'mosaic'} scope={singleScope} />
      </div>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', mosaicMode !== 'mosaic' && 'hidden')}>
        <SessionMosaic foreground={mosaicMode === 'mosaic'} />
      </div>
    </>
  )
}

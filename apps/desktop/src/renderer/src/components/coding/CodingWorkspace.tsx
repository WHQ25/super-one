import { useLayoutEffect, useMemo, useState } from 'react'
import { SlotChain, SlotScopeProvider } from '@superone/ui-slots/react'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { cn } from '@superone/ui/lib/utils'
import { SessionMosaic } from '@/components/mosaic/SessionMosaic'
import { useChatStore, type SessionScope } from '@/stores/chat'
import { resolveProvider } from '@/stores/chat-store/helpers/provider-routing'
import { PluginSlotErrorBoundary } from '@/lib/ui-slots'
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

  const singleHarness = useChatStore((s) => {
    if (!singleScope) return null
    const session = s.projectSessions[singleScope.projectPath]?._sessions?.[singleScope.sessionId]
    return session ? resolveProvider({ sessionProvider: session.sessionProvider, preferredProvider: session.preferredProvider }) : null
  })
  const singleSupportsUiPlugins = singleHarness ? HARNESS_CAPABILITIES[singleHarness].supportsUiPlugins : false
  const renderDefaultSingleWorkspace = () => <CodingLayout foreground={effectiveMode !== 'mosaic'} scope={singleScope} compact={compact} />

  return (
    <>
      <div data-layout-single className={cn('flex min-h-0 min-w-0 flex-1 flex-col', effectiveMode === 'mosaic' && 'hidden')}>
        <SlotScopeProvider active={singleSupportsUiPlugins} scope={singleScope}>
          <PluginSlotErrorBoundary resetKey={singleScope?.sessionId ?? 'single'} fallback={renderDefaultSingleWorkspace}>
            <SlotChain
              name="workspace.view"
              props={{ mosaicMode: effectiveMode, compact, scope: singleScope }}
              fallback={renderDefaultSingleWorkspace}
            />
          </PluginSlotErrorBoundary>
        </SlotScopeProvider>
      </div>
      <div className={cn('flex min-h-0 min-w-0 flex-1 flex-col', effectiveMode !== 'mosaic' && 'hidden')}>
        <SessionMosaic foreground={effectiveMode === 'mosaic'} />
      </div>
    </>
  )
}

import { Suspense, lazy } from 'react'
import i18next from 'i18next'
import { Hexagon } from 'lucide-react'
import type { ClientKernel, KernelScope, MenuContext } from '@superone/client-kernel'
import { HARNESS_CAPABILITIES } from '@superone/shared/harness/harness-capabilities'
import { openSwarmBoardTab } from '@/components/activity/activity-panel-api'

function translateMenu(ctx: MenuContext, key: string): string {
  const t = ctx.extra?.t as ((k: string) => string) | undefined
  return typeof t === 'function' ? t(key) : i18next.t(key)
}

const LazySwarmBoardPanel = lazy(() =>
  import('./SwarmBoardPanel').then((mod) => ({ default: mod.SwarmBoardPanel })),
)

function SwarmBoardSlotPanel(props: { params: Record<string, unknown> }) {
  const sessionId = typeof props.params.sessionId === 'string' ? props.params.sessionId : ''
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>}>
      <LazySwarmBoardPanel sessionId={sessionId} />
    </Suspense>
  )
}

export function registerSwarmPlugin(kernel: ClientKernel): KernelScope {
  const scope = kernel.createScope()

  scope.slots.registerKeyed('activity.panel', 'swarm-board', {
    component: SwarmBoardSlotPanel,
  })

  scope.registerCommand({
    id: 'swarmBoard.open',
    title: 'Open Swarm Board',
    category: 'activity',
    handler: (sessionId?: string, title?: string) => {
      if (!sessionId) return false
      openSwarmBoardTab(sessionId, title ?? i18next.t('swarmBoard.title'))
      return true
    },
  })

  scope.registerMenuItem('activity.launcher', {
    id: 'swarm-board',
    group: '10-builtin',
    order: 55,
    icon: Hexagon,
    label: (ctx) => translateMenu(ctx, 'swarmBoard.title'),
    when: (ctx) =>
      Boolean(ctx.provider && HARNESS_CAPABILITIES[ctx.provider as keyof typeof HARNESS_CAPABILITIES]?.supportsSwarmBoard) &&
      Boolean(ctx.sessionId) &&
      ctx.extra?.hasSwarm === true,
    onSelect: (ctx) => {
      if (!ctx.sessionId) return
      void kernel.commands.executeCommand('swarmBoard.open', ctx.sessionId, translateMenu(ctx, 'swarmBoard.title'))
    },
  })

  return scope
}

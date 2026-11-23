import { Suspense, lazy } from 'react'
import i18next from 'i18next'
import { Route } from 'lucide-react'
import type { ClientKernel, KernelScope, MenuContext } from '@superone/client-kernel'
import { openTrajectoryTab } from '@/components/activity/activity-panel-api'

function translateMenu(ctx: MenuContext, key: string): string {
  const t = ctx.extra?.t as ((k: string) => string) | undefined
  return typeof t === 'function' ? t(key) : i18next.t(key)
}

const LazyTrajectoryPanel = lazy(() =>
  import('./TrajectoryPanel').then((mod) => ({ default: mod.TrajectoryPanel })),
)

function TrajectorySlotPanel(props: { params: Record<string, unknown> }) {
  const sessionId = typeof props.params.sessionId === 'string' ? props.params.sessionId : ''
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>}>
      <LazyTrajectoryPanel sessionId={sessionId} />
    </Suspense>
  )
}

export function registerTrajectoryPlugin(kernel: ClientKernel): KernelScope {
  const scope = kernel.createScope()

  scope.slots.registerKeyed('activity.panel', 'trajectory', {
    component: TrajectorySlotPanel,
  })

  scope.registerCommand({
    id: 'trajectory.open',
    title: 'Open Trajectory',
    category: 'activity',
    handler: (sessionId?: string, title?: string) => {
      if (!sessionId) return false
      openTrajectoryTab(sessionId, title ?? i18next.t('trajectory.title'))
      return true
    },
  })

  scope.registerMenuItem('activity.launcher', {
    id: 'trajectory',
    group: '10-builtin',
    order: 50,
    icon: Route,
    label: (ctx) => translateMenu(ctx, 'trajectory.title'),
    when: (ctx) => ctx.supportsUiPlugins === true && Boolean(ctx.sessionId),
    onSelect: (ctx) => {
      if (!ctx.sessionId) return
      void kernel.commands.executeCommand('trajectory.open', ctx.sessionId, translateMenu(ctx, 'trajectory.title'))
    },
  })

  return scope
}

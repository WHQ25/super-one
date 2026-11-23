import { Suspense, lazy } from 'react'
import i18next from 'i18next'
import { FileDiff } from 'lucide-react'
import type { ClientKernel, KernelScope, MenuContext } from '@superone/client-kernel'
import type { ReviewScope } from '@superone/shared/review-types'
import { openReviewTab } from '@/components/activity/activity-panel-api'

function translateMenu(ctx: MenuContext, key: string): string {
  const t = ctx.extra?.t as ((k: string) => string) | undefined
  return typeof t === 'function' ? t(key) : i18next.t(key)
}

const LazyReviewPanel = lazy(() => import('./ReviewPanel'))

function ReviewSlotPanel(props: { params: Record<string, unknown> }) {
  const sessionId = typeof props.params.sessionId === 'string' ? props.params.sessionId : undefined
  const projectPath = typeof props.params.projectPath === 'string' ? props.params.projectPath : undefined
  const initialScope = props.params.initialScope as ReviewScope | undefined
  return (
    <Suspense fallback={<div className="flex h-full items-center justify-center text-xs text-muted-foreground">Loading…</div>}>
      <LazyReviewPanel
        sessionId={sessionId}
        projectPath={projectPath}
        initialScope={initialScope}
      />
    </Suspense>
  )
}

export function registerReviewPlugin(kernel: ClientKernel): KernelScope {
  const scope = kernel.createScope()

  scope.slots.registerKeyed('activity.panel', 'review', {
    component: ReviewSlotPanel,
  })

  scope.registerCommand({
    id: 'review.open',
    title: 'Open Review',
    category: 'activity',
    handler: (projectPath?: string, sessionId?: string, title?: string) => {
      if (!projectPath) return false
      openReviewTab({
        projectPath,
        sessionId,
        label: title ?? i18next.t('review.title'),
      })
      return true
    },
  })

  scope.registerMenuItem('activity.launcher', {
    id: 'review',
    group: '10-builtin',
    order: 30,
    icon: FileDiff,
    label: (ctx) => translateMenu(ctx, 'review.title'),
    disabled: (ctx) => !ctx.hasFolder,
    onSelect: (ctx) => {
      if (!ctx.projectPath) return
      void kernel.commands.executeCommand('review.open', ctx.projectPath, ctx.sessionId ?? undefined, translateMenu(ctx, 'review.title'))
    },
  })

  return scope
}

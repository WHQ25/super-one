/**
 * Shared User / Project scope switch for harness resource settings pages.
 * Uses the same Tabs sliding-pill switcher as Harness config tabs above
 * (min-h-10 / py-2). Project picker stays mounted to avoid toolbar height jump.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import { cn } from '@superone/ui/lib/utils'
import { ProjectSelector } from '@/components/coding/ProjectSelector'

export type ResourceScopeView = 'user' | 'project'

interface ResourceScopeToolbarProps {
  scope: ResourceScopeView
  onScopeChange: (scope: ResourceScopeView) => void
  /** Page-specific actions rendered on the right (Refresh, Add, …). */
  actions?: ReactNode
  className?: string
}

export function ResourceScopeToolbar({
  scope,
  onScopeChange,
  actions,
  className,
}: ResourceScopeToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('mb-6 flex items-center justify-between gap-3', className)}>
      <Tabs
        value={scope}
        onValueChange={(v) => onScopeChange(v as ResourceScopeView)}
      >
        <TabsList className="h-auto min-h-10 w-auto p-1">
          <TabsTrigger value="user" className="px-3 py-2 text-xs">
            {t('resources.sectionUser')}
          </TabsTrigger>
          <TabsTrigger value="project" className="px-3 py-2 text-xs">
            {t('resources.sectionProject')}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {actions}
        <div className="shrink-0">
          <ProjectSelector />
        </div>
      </div>
    </div>
  )
}

/**
 * Shared User / Project scope switch for harness resource settings pages.
 * A segmented control rather than Tabs: it switches the page's data source, not
 * between tab panels. Project picker stays mounted to avoid toolbar height jump.
 */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { ProjectSelector } from '@/components/coding/ProjectSelector'
import { SettingsSegmentedControl } from './SettingsSegmentedControl'
import { settingsSelectTriggerClassName } from './select-trigger-class'

export type ResourceScopeView = 'user' | 'project'

interface ResourceScopeToolbarProps {
  scope: ResourceScopeView
  onScopeChange: (scope: ResourceScopeView) => void
  availableScopes?: readonly ResourceScopeView[]
  /** Page-specific actions rendered on the right (Refresh, Add, …). */
  actions?: ReactNode
  className?: string
}

export function ResourceScopeToolbar({
  scope,
  onScopeChange,
  availableScopes = ['user', 'project'],
  actions,
  className,
}: ResourceScopeToolbarProps) {
  const { t } = useTranslation()

  return (
    <div className={cn('mb-4 flex items-center justify-between gap-3', className)}>
      <SettingsSegmentedControl
        value={scope}
        onChange={onScopeChange}
        label={`${t('resources.sectionUser')} / ${t('resources.sectionProject')}`}
        options={availableScopes.map((availableScope) => ({
          value: availableScope,
          label: t(availableScope === 'user' ? 'resources.sectionUser' : 'resources.sectionProject'),
        }))}
      />

      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        {actions}
        <ProjectSelector triggerClassName={cn(settingsSelectTriggerClassName, 'gap-2 py-0')} />
      </div>
    </div>
  )
}

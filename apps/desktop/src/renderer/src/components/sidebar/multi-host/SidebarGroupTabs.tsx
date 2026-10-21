import { useTranslation } from 'react-i18next'
import { Tabs, TabsList, TabsTrigger } from '@superone/ui/components/ui/tabs'
import type { SidebarGroupBy } from '@/lib/multi-host/types'

/** Project versus environment. The environment picker stays a dropdown; this list is fixed. */
export function SidebarGroupTabs({
  value,
  onChange,
}: {
  value: SidebarGroupBy
  onChange: (value: SidebarGroupBy) => void
}) {
  const { t } = useTranslation()
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as SidebarGroupBy)} className="min-w-0">
      <TabsList aria-label={t('sidebar.groupBy.label')} className="h-7">
        <TabsTrigger value="project">{t('sidebar.groupBy.project')}</TabsTrigger>
        <TabsTrigger value="environment">{t('sidebar.groupBy.environment')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}

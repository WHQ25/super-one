import { FolderOpen } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/stores/app'

export function StartupPage(): React.JSX.Element {
  const { t } = useTranslation()
  const selectAndOpenFolder = useAppStore((s) => s.selectAndOpenFolder)

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8">
      <div className="text-center">
        <h1 className="text-4xl font-bold">{t('shell.startup.title')}</h1>
        <p className="mt-2 text-muted-foreground">{t('shell.startup.tagline')}</p>
      </div>

      <Button size="lg" onClick={selectAndOpenFolder}>
        <FolderOpen className="size-5" />
        {t('shell.startup.openProject')}
      </Button>
    </div>
  )
}

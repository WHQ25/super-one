import { useTranslation } from 'react-i18next'
import { Button } from '@superone/ui/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@superone/ui/components/ui/dialog'
import { useAppStore } from '@/stores/app'

/**
 * The macOS bundle-id bridge, from the user's side.
 *
 * Shown by a build that runs under the retired bundle id: Squirrel cannot
 * install the new-id build over it, so the app downloads the installer into
 * ~/Downloads and hands the actual swap to Finder. Opens itself once per
 * launch and again from the sidebar pill; "Later" only hides it, because the
 * bridge build has no other way forward.
 */
export function IdentityMigrationDialog() {
  const { t } = useTranslation()
  const status = useAppStore((s) => s.updateStatus)
  const open = useAppStore((s) => s.migrationDialogOpen)
  const setOpen = useAppStore((s) => s.setMigrationDialogOpen)
  const version = useAppStore((s) => s.updateVersion)
  const progress = useAppStore((s) => s.updateProgress)
  const errorMessage = useAppStore((s) => s.updateErrorMessage)
  const installerPath = useAppStore((s) => s.migrationInstallerPath)
  const download = useAppStore((s) => s.migrationDownload)
  const openInstaller = useAppStore((s) => s.migrationOpenInstaller)
  const reveal = useAppStore((s) => s.migrationReveal)

  if (!status.startsWith('migration-')) return null

  const downloading = status === 'migration-downloading'
  const downloaded = status === 'migration-downloaded'
  const failed = status === 'migration-error'
  const percent = Math.min(100, Math.max(0, Math.round(progress)))
  const fileName = installerPath?.split('/').pop() ?? ''

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="max-w-md" data-testid="identity-migration-dialog">
        <DialogHeader>
          <DialogTitle>{t('shell.update.migration.title')}</DialogTitle>
          <DialogDescription className="space-y-2">
            <span className="block">{t('shell.update.migration.body')}</span>
            <span className="block">{t('shell.update.migration.keeps')}</span>
          </DialogDescription>
        </DialogHeader>

        {downloading && (
          <div className="space-y-1.5" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="text-xs text-muted-foreground">
              {t('shell.update.migration.downloading', { version: version ?? '', progress: percent })}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}
        {downloaded && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <p>{t('shell.update.migration.downloadedWhere', { file: fileName })}</p>
            <p>{t('shell.update.migration.downloadedSteps')}</p>
          </div>
        )}
        {failed && (
          <p className="text-xs text-error" role="alert">
            {t('shell.update.migration.error', { message: errorMessage ?? '' })}
          </p>
        )}

        <DialogFooter className="flex-row items-center gap-2">
          {downloaded && (
            <Button variant="ghost" className="mr-auto" onClick={reveal}>
              {t('shell.update.migration.reveal')}
            </Button>
          )}
          <Button variant="outline" onClick={() => setOpen(false)} disabled={downloading}>
            {t('shell.update.migration.later')}
          </Button>
          {downloaded ? (
            <Button onClick={openInstaller}>{t('shell.update.migration.openAndQuit')}</Button>
          ) : (
            <Button onClick={download} disabled={downloading}>
              {failed
                ? t('shell.update.migration.retry')
                : version
                  ? t('shell.update.migration.downloadVersion', { version: `v${version}` })
                  : t('shell.update.migration.download')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

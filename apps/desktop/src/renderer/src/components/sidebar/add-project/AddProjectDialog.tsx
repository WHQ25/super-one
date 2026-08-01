import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CornerLeftUp, Folder, FolderPlus, Github, Link2, Loader2 } from 'lucide-react'
import { githubOwnerAvatarUrl, parseGitHubRepoInput } from '@superone/shared/git-remote'
import { Button } from '@superone/ui/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@superone/ui/components/ui/dialog'
import { IconButton } from '@superone/ui/components/ui/icon-button'
import { Kbd } from '@superone/ui/components/ui/kbd'
import { cn } from '@superone/ui/lib/utils'
import { AddProjectList } from './AddProjectList'
import { submitLabelKey, type AddProjectSource } from './add-project-flow'
import { useAddProjectDialog } from './use-add-project-dialog'

function GithubOwnerAvatar({ owner, className }: { owner: string; className?: string }) {
  return (
    <img
      src={githubOwnerAvatarUrl(owner, 40)}
      alt=""
      className={cn('size-4 rounded-sm object-cover', className)}
      loading="lazy"
      referrerPolicy="no-referrer"
    />
  )
}

interface AddProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string
  hostLabel: string
  onOpened: (project: { projectId: string; path: string; name: string }) => void
}

const SOURCE_ICONS: Record<AddProjectSource, ReactNode> = {
  local: <FolderPlus className="size-3.5" />,
  github: <Github className="size-3.5" />,
  url: <Link2 className="size-3.5" />,
}
const PARENT_ICON = <CornerLeftUp className="size-3.5" />
const DIRECTORY_ICON = <Folder className="size-3.5" />

/**
 * Multi-step add-project dialog: pick a source, then either browse the host
 * filesystem or type a repository and choose where to clone it.
 *
 * Every step drives the same input box and the same result list — Tab completes
 * a path, Enter confirms the step, Backspace on an empty input goes back.
 */
export function AddProjectDialog({
  open,
  onOpenChange,
  connectionId,
  hostLabel,
  onOpened,
}: AddProjectDialogProps) {
  const { t } = useTranslation()
  const flow = useAddProjectDialog({
    open,
    connectionId,
    onOpenChange,
    onOpened,
    sourceIcons: SOURCE_ICONS,
    parentIcon: PARENT_ICON,
    directoryIcon: DIRECTORY_ICON,
  })
  const { step } = flow

  const placeholder = useMemo(() => {
    switch (step.kind) {
      case 'source':
        return t('sidebar.addProject.sources.searchPlaceholder')
      case 'repo':
        return t(
          step.source === 'github'
            ? 'sidebar.addProject.repoPlaceholderGithub'
            : 'sidebar.addProject.repoPlaceholderUrl',
        )
      case 'destination':
        return t('sidebar.addProject.destinationPlaceholder')
      case 'browse':
        return t(
          flow.isLocal
            ? 'sidebar.addProject.pathPlaceholderLocal'
            : 'sidebar.addProject.pathPlaceholderRemote',
        )
    }
  }, [step, flow.isLocal, t])

  return (
    <Dialog open={open} onOpenChange={(next) => !flow.busy && onOpenChange(next)}>
      {/*
        Fixed-height shell: list and footer content change between steps, and a
        viewport-centred Radix dialog would otherwise jump under the caret.
      */}
      <DialogContent
        className="flex h-[min(32rem,85vh)] w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={!flow.busy}
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3">
          <DialogTitle className="text-base">{t('sidebar.addProject.title')}</DialogTitle>
          {/* Host context stays for assistive tech only — the sidebar already
              shows which environment is selected. */}
          <DialogDescription className="sr-only">
            {t('sidebar.addProject.description', { host: hostLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-1 border-b px-2">
          {step.kind !== 'source' && (
            <IconButton
              size="sm"
              variant="ghost"
              tabIndex={-1}
              disabled={flow.busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={flow.goBack}
            >
              <ArrowLeft />
            </IconButton>
          )}
          <input
            ref={flow.inputRef}
            value={flow.query}
            onChange={(e) => flow.setQuery(e.target.value)}
            placeholder={placeholder}
            disabled={flow.busy}
            spellCheck={false}
            autoComplete="off"
            className={cn(
              'h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60',
              step.kind !== 'source' && 'font-mono',
            )}
            onKeyDown={(e) => {
              // IME composition (e.g. Chinese/Japanese): Enter confirms a candidate,
              // not the dialog step. keyCode 229 covers older engines that omit isComposing.
              if (e.nativeEvent.isComposing || e.keyCode === 229) return

              if (e.key === 'ArrowDown') {
                e.preventDefault()
                flow.moveSelection(1)
                return
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault()
                flow.moveSelection(-1)
                return
              }
              if (e.key === 'Tab' && flow.isPathStep) {
                e.preventDefault()
                flow.completePath()
                return
              }
              if (e.key === 'Enter') {
                e.preventDefault()
                flow.submit()
                return
              }
              if (e.key === 'Backspace' && flow.query === '' && step.kind !== 'source') {
                e.preventDefault()
                flow.goBack()
              }
            }}
          />
          {flow.isLocal && flow.isPathStep && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 shrink-0 px-2 text-xs"
              tabIndex={-1}
              disabled={flow.busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void flow.pickNativeFolder()}
            >
              {t('sidebar.addProject.browse')}
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 shrink-0 px-2 text-xs"
            tabIndex={-1}
            disabled={!flow.canSubmit}
            onMouseDown={(e) => e.preventDefault()}
            onClick={flow.submit}
          >
            {flow.busy && <Loader2 className="size-3 animate-spin" />}
            {flow.busy && step.kind === 'destination'
              ? t('sidebar.addProject.cloning')
              : t(submitLabelKey(step, flow.submitLabelPath))}
          </Button>
        </div>

        {step.kind === 'destination' && (
          <div className="shrink-0 border-b px-3 py-2">
            <div className="pb-1 text-xs font-medium text-muted-foreground">
              {t('sidebar.addProject.repository')}
            </div>
            <div className="flex items-center gap-2">
              <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
                {(() => {
                  const ref =
                    step.source === 'github' ? parseGitHubRepoInput(step.repoInput) : null
                  return ref ? (
                    <GithubOwnerAvatar owner={ref.owner} />
                  ) : (
                    SOURCE_ICONS[step.source]
                  )
                })()}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="truncate text-sm">{step.repoInput}</span>
                <span className="truncate font-mono text-[11px] text-muted-foreground">
                  {step.remoteUrl}
                </span>
              </div>
            </div>
            {flow.clonePreviewPath && (
              <div className="truncate pt-1 font-mono text-[11px] text-muted-foreground">
                {t('sidebar.addProject.clonesInto', {
                  path: flow.clonePreviewPath,
                })}
              </div>
            )}
          </div>
        )}

        {/* Only this region scrolls, so the shell height stays stable */}
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {step.kind === 'repo' && step.source === 'url' ? (
            <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-1 px-6 text-center text-xs text-muted-foreground">
              {flow.repoResolved ? (
                <>
                  <span className="text-sm text-foreground">{flow.repoResolved.repoName}</span>
                  <span className="font-mono break-all">{flow.repoResolved.remoteUrl}</span>
                </>
              ) : (
                t('sidebar.addProject.repoInvalidUrl')
              )}
            </div>
          ) : step.kind === 'repo' && step.source === 'github' ? (
            flow.githubLoading && flow.itemCount === 0 ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('common.loading')}
              </div>
            ) : flow.githubError && flow.itemCount === 0 ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs break-words text-muted-foreground">
                {flow.githubError}
              </div>
            ) : flow.itemCount === 0 ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {flow.githubSearchOwner
                  ? t('sidebar.addProject.githubNoRepos')
                  : t('sidebar.addProject.repoInvalidGithub')}
              </div>
            ) : (
              <AddProjectList
                sectionLabel={t('sidebar.addProject.githubRepos')}
                items={flow.items}
                selectedIndex={flow.selectedIndex}
                onActivate={flow.activateItem}
                onHover={flow.setSelectedIndex}
              />
            )
          ) : flow.browseLoading && flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : flow.browseError && flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs break-words text-muted-foreground">
              {flow.browseError}
            </div>
          ) : flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
              {t('sidebar.addProject.noDirectories')}
            </div>
          ) : (
            <AddProjectList
              sectionLabel={
                step.kind === 'source'
                  ? t('sidebar.addProject.sources.title')
                  : t('sidebar.addProject.directories')
              }
              items={flow.items}
              selectedIndex={flow.selectedIndex}
              onActivate={flow.activateItem}
              onHover={flow.setSelectedIndex}
            />
          )}
        </div>

        {/* Errors only take space when there is one — the shell height is fixed,
            so the list absorbs the difference instead of the dialog resizing. */}
        {flow.submitError && (
          <div className="shrink-0 border-t px-3 py-1.5 text-xs break-words text-destructive">
            {flow.submitError}
          </div>
        )}

        {/* Shortcut hints stay the last row of the dialog */}
        <div className="shrink-0 border-t border-border px-2 py-1 text-xs text-muted-foreground">
          {flow.isPathStep && (
            <>
              <Kbd>tab</Kbd> {t('sidebar.addProject.hintTab')}
              <span className="mx-1.5">&middot;</span>
            </>
          )}
          <Kbd>↵</Kbd> {t('sidebar.addProject.hintEnter')}
          {flow.itemCount > 0 && (
            <>
              <span className="mx-1.5">&middot;</span>
              <Kbd>↑↓</Kbd> {t('sidebar.addProject.hintNav')}
            </>
          )}
          {step.kind !== 'source' && (
            <>
              <span className="mx-1.5">&middot;</span>
              <Kbd>⌫</Kbd> {t('sidebar.addProject.hintBack')}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

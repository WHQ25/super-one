import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  CornerLeftUp,
  Folder,
  FolderPlus,
  Github,
  Link2,
  Loader2,
} from 'lucide-react'
import { githubOwnerAvatarUrl, parseGitHubRepoInput } from '@superone/shared/git-remote'
import { Button } from '@superone/ui/components/ui/button'
import { Checkbox } from '@superone/ui/components/ui/checkbox'
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
const CREATE_DIRECTORY_ICON = <FolderPlus className="size-3.5" />

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
    createDirectoryIcon: CREATE_DIRECTORY_ICON,
  })
  const { step } = flow
  /**
   * Chromium often reports `isComposing=false` on the Enter that ends an IME
   * session. Track composition ourselves and clear one frame late so that
   * trailing Enter only confirms the candidate, not the dialog step.
   */
  const imeComposingRef = useRef(false)
  /** Ghost text only when the caret is at the end of the input (shell-like). */
  const [caretAtEnd, setCaretAtEnd] = useState(true)
  /** Keep the ghost overlay horizontally aligned with the scrolled input text. */
  const [inputScrollLeft, setInputScrollLeft] = useState(0)

  /** Scroll the path input to the end so long paths keep the caret visible. */
  const scrollPathInputToEnd = useCallback(() => {
    const el = flow.inputRef.current
    if (!el) return
    // Double rAF: first paint applies the new value, second reads scrollWidth.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.scrollLeft = el.scrollWidth
        setInputScrollLeft(el.scrollLeft)
      })
    })
  }, [flow.inputRef])

  // Typing, Tab-complete, and arrow navigation all update `query` — pin scroll
  // to the end while the caret stays at the end (path steps only).
  useEffect(() => {
    if (!flow.isPathStep || !caretAtEnd) return
    scrollPathInputToEnd()
  }, [flow.query, flow.pathInlineGhost, flow.isPathStep, caretAtEnd, scrollPathInputToEnd])

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

  const submitLabel =
    flow.busy && step.kind === 'destination'
      ? t('sidebar.addProject.cloning')
      : t(submitLabelKey(step))

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
          {/*
            Path steps use inline ghost completion. When a ghost is shown the
            native caret is hidden and we paint a caret after the last user-owned
            character (end of typed query for prefix; last fuzzy match for fuzzy)
            so it never sits in the middle of the ghost tail.
          */}
          <div className="relative min-w-0 flex-1 overflow-hidden">
            {flow.isPathStep && flow.pathInlineGhost && caretAtEnd ? (
              <div
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-y-0 left-0 flex items-center text-sm',
                  'font-mono whitespace-nowrap',
                )}
                style={{ transform: `translateX(-${inputScrollLeft}px)` }}
              >
                {flow.pathInlineGhost.kind === 'suffix' ? (
                  <>
                    <span className="whitespace-pre text-foreground">{flow.query}</span>
                    {/* Caret at end of typed input — always before the ghost tail. */}
                    <span className="h-4 w-px shrink-0 self-center bg-foreground" />
                    <span className="whitespace-pre text-muted-foreground/40">
                      {flow.pathInlineGhost.text}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="whitespace-pre text-foreground">
                      {flow.pathInlineGhost.dir}
                    </span>
                    {(() => {
                      const ghost = flow.pathInlineGhost
                      if (ghost.kind !== 'fuzzy') return null
                      const matchSet = new Set(ghost.matchIndices)
                      const lastMatch =
                        ghost.matchIndices.length > 0
                          ? Math.max(...ghost.matchIndices)
                          : -1
                      const nodes: ReactNode[] = []
                      ghost.name.split('').forEach((ch, i) => {
                        if (i === lastMatch + 1) {
                          nodes.push(
                            <span
                              key="caret"
                              className="h-4 w-px shrink-0 self-center bg-foreground"
                            />,
                          )
                        }
                        nodes.push(
                          <span
                            key={`${i}-${ch}`}
                            className={cn(
                              'whitespace-pre',
                              matchSet.has(i)
                                ? 'text-foreground'
                                : 'text-muted-foreground/40',
                            )}
                          >
                            {ch}
                          </span>,
                        )
                      })
                      // Typed leaf covers the whole name — caret sits before the trailing sep.
                      if (lastMatch === ghost.name.length - 1) {
                        nodes.push(
                          <span
                            key="caret-end"
                            className="h-4 w-px shrink-0 self-center bg-foreground"
                          />,
                        )
                      }
                      return nodes
                    })()}
                    <span className="whitespace-pre text-muted-foreground/40">
                      {flow.pathInlineGhost.sep}
                    </span>
                  </>
                )}
              </div>
            ) : null}
            <input
              ref={flow.inputRef}
              value={flow.query}
              onChange={(e) => {
                flow.setQuery(e.target.value)
                const el = e.target
                setCaretAtEnd(el.selectionStart === el.value.length)
              }}
              onScroll={(e) => {
                setInputScrollLeft(e.currentTarget.scrollLeft)
              }}
              placeholder={placeholder}
              disabled={flow.busy}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'relative h-11 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60',
                step.kind !== 'source' && 'font-mono',
                // Ghost layer paints text + caret; hide the native ones to avoid
                // the caret landing mid-ghost when overlay length ≠ query length.
                flow.isPathStep &&
                  flow.pathInlineGhost &&
                  caretAtEnd &&
                  'text-transparent caret-transparent',
              )}
              onSelect={(e) => {
                const el = e.currentTarget
                setCaretAtEnd(el.selectionStart === el.value.length)
              }}
              onClick={(e) => {
                const el = e.currentTarget
                setCaretAtEnd(el.selectionStart === el.value.length)
              }}
              onKeyUp={(e) => {
                const el = e.currentTarget
                setCaretAtEnd(el.selectionStart === el.value.length)
              }}
              onCompositionStart={() => {
                imeComposingRef.current = true
              }}
              onCompositionEnd={() => {
                // Defer clear so the Enter/Space that committed the candidate is
                // still treated as composition and does not submit/navigate.
                requestAnimationFrame(() => {
                  imeComposingRef.current = false
                })
              }}
              onKeyDown={(e) => {
                // IME composition (e.g. Chinese/Japanese): Enter confirms a candidate,
                // not the dialog step. keyCode 229 covers older engines that omit isComposing.
                if (
                  imeComposingRef.current ||
                  e.nativeEvent.isComposing ||
                  e.keyCode === 229
                ) {
                  return
                }

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
          </div>
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
            {submitLabel}
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
                <span className="truncate text-sm">
                  {(() => {
                    // Normalize pasted GitHub URLs to owner/repo for the title.
                    const ref =
                      step.source === 'github' ? parseGitHubRepoInput(step.repoInput) : null
                    return ref ? `${ref.owner}/${ref.repo}` : step.repoInput
                  })()}
                </span>
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
            <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={flow.saveAsDefault}
                disabled={flow.busy}
                onCheckedChange={(value) => flow.setSaveAsDefault(value === true)}
              />
              <span className="min-w-0 leading-snug">
                {t('sidebar.addProject.saveAsDefaultClonePath')}
              </span>
            </label>
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
            flow.listSections.length > 0 ? (
              <AddProjectList
                sections={flow.listSections}
                selectedIndex={flow.selectedIndex}
                onActivate={flow.activateItem}
                onHover={flow.setSelectedIndex}
              />
            ) : flow.githubLoading ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('common.loading')}
              </div>
            ) : flow.repoResolved ? (
              // Paste of owner/repo or a full GitHub URL — same card shape as a search hit.
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
                {(() => {
                  const ref = parseGitHubRepoInput(flow.query)
                  return (
                    <>
                      {ref ? (
                        <GithubOwnerAvatar owner={ref.owner} className="size-8 rounded-md" />
                      ) : (
                        <Github className="size-8 text-muted-foreground" />
                      )}
                      <span className="text-sm text-foreground">
                        {ref ? `${ref.owner}/${ref.repo}` : flow.repoResolved.repoName}
                      </span>
                      <span className="font-mono break-all">
                        {flow.repoResolved.remoteUrl}
                      </span>
                    </>
                  )
                })()}
              </div>
            ) : flow.githubError ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs break-words text-muted-foreground">
                {flow.githubError}
              </div>
            ) : (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {flow.githubSearchOwner
                  ? t('sidebar.addProject.githubNoRepos')
                  : t('sidebar.addProject.repoInvalidGithub')}
              </div>
            )
          ) : flow.browseLoading && flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : flow.listSections.length > 0 ? (
            <AddProjectList
              sections={flow.listSections}
              selectedIndex={flow.selectedIndex}
              onActivate={flow.activateItem}
              onHover={flow.setSelectedIndex}
            />
          ) : flow.browseError && flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs break-words text-muted-foreground">
              {flow.browseError}
            </div>
          ) : (
            <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
              {t('sidebar.addProject.noDirectories')}
            </div>
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

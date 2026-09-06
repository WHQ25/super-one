import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Folder,
  FolderPlus,
  Link2,
  Loader2,
} from 'lucide-react'
import { GithubIcon } from '@/components/GithubIcon'
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
import {
  confirmActionKey,
  enterLabelKey,
  stepTitleKey,
  type AddProjectSource,
} from '@superone/shared/add-project-flow'
import { useAddProjectDialog } from './use-add-project-dialog'

function GithubOwnerAvatar({ owner, className }: { owner: string; className?: string }) {
  return (
    <img
      src={githubOwnerAvatarUrl(owner, 80)}
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
  local: <FolderPlus className="size-[18px]" />,
  github: <GithubIcon className="size-[18px]" />,
  url: <Link2 className="size-[18px]" />,
}
const DIRECTORY_ICON = <Folder className="size-3.5" />
const CREATE_DIRECTORY_ICON = <FolderPlus className="size-3.5" />

/** Compact Finder-style face for "Browse with". */
function FinderGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect width="16" height="16" rx="3.5" fill="#5AC8FA" />
      <path d="M8 0v16" stroke="#fff" strokeOpacity="0.35" />
      <circle cx="5.2" cy="6.2" r="1" fill="#1d1d1f" />
      <circle cx="10.8" cy="6.2" r="1" fill="#1d1d1f" />
      <path
        d="M5.2 10.4c.8 1.2 4.8 1.2 5.6 0"
        fill="none"
        stroke="#1d1d1f"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Compact File Explorer-style mark for "Browse with". */
function FileExplorerGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} aria-hidden>
      <rect width="16" height="16" rx="3" fill="#0078D4" />
      <rect x="2" y="4.2" width="5.2" height="3.6" rx="0.6" fill="#FDE047" />
      <rect x="8.6" y="4.2" width="5.4" height="7.6" rx="0.6" fill="#FACC15" />
      <rect x="2" y="8.4" width="5.2" height="3.4" rx="0.6" fill="#FDE68A" />
    </svg>
  )
}

function NativeBrowseControl({
  label,
  ariaLabel,
  disabled,
  onClick,
}: {
  label: string
  ariaLabel: string
  disabled: boolean
  onClick: () => void
}) {
  const isWindows = window.app?.platform === 'win32'
  const Glyph = isWindows ? FileExplorerGlyph : FinderGlyph
  return (
    <button
      type="button"
      tabIndex={-1}
      disabled={disabled}
      aria-label={ariaLabel}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      {label}
      <Glyph className="size-3.5" />
    </button>
  )
}

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

  const selectedKey = flow.items[flow.selectedIndex]?.key
  const enterHintKey = enterLabelKey(step, selectedKey)
  const enterHint =
    flow.busy && step.kind === 'destination'
      ? t('sidebar.addProject.cloning')
      : enterHintKey
        ? t(enterHintKey)
        : null
  const confirmHintKey = confirmActionKey(step, Boolean(flow.willCreatePath))
  const confirmLabel = confirmHintKey ? t(confirmHintKey) : ''
  const listSections = useMemo(() => {
    if (!flow.isPathStep || !flow.isLocal) return flow.listSections
    const browseWith = t('sidebar.addProject.browseWith')
    const browseAria =
      window.app?.platform === 'win32'
        ? t('sidebar.addProject.browseWithExplorer')
        : t('sidebar.addProject.browseWithFinder')
    return flow.listSections.map((section) =>
      section.key === 'directories'
        ? {
            ...section,
            headerAction: (
              <NativeBrowseControl
                label={browseWith}
                ariaLabel={browseAria}
                disabled={flow.busy}
                onClick={() => void flow.pickNativeFolder()}
              />
            ),
          }
        : section,
    )
  }, [flow.isPathStep, flow.isLocal, flow.listSections, flow.busy, flow.pickNativeFolder, t])

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
        {/*
          Match horizontal inset with the input row (px-4). pr-12 clears the
          absolute close button so title and field share the same content width.
        */}
        <DialogHeader className="shrink-0 space-y-0 px-4 pt-3 pb-1 pr-12">
          <DialogTitle className="flex items-center gap-2 text-base">
            {/* size-4 slot — keep in lockstep with the back control below. */}
            <span className="flex size-4 shrink-0 items-center justify-center">
              <FolderPlus className="size-4 text-muted-foreground" aria-hidden />
            </span>
            {t(stepTitleKey(step))}
          </DialogTitle>
          {/* Host context stays for assistive tech only — the sidebar already
              shows which environment is selected. */}
          <DialogDescription className="sr-only">
            {t('sidebar.addProject.description', { host: hostLabel })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4">
          {/* Local browse has no back control — clearing the path returns to sources. */}
          {(step.kind === 'repo' || step.kind === 'destination') && (
            <IconButton
              // Same size-4 footprint as the title FolderPlus so the glyphs line up.
              size="sm"
              variant="ghost"
              tabIndex={-1}
              disabled={flow.busy}
              className="size-4 [&_svg:not([class*='size-'])]:size-4"
              onMouseDown={(e) => e.preventDefault()}
              onClick={flow.goBack}
            >
              <ArrowLeft />
            </IconButton>
          )}
          {/*
            Path steps use prefix ghost completion. When a ghost is shown the
            native caret is hidden and we paint a caret after the typed query
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
                <span className="whitespace-pre text-foreground">{flow.query}</span>
                {/* Caret at end of typed input — always before the ghost tail. */}
                <span className="h-4 w-px shrink-0 self-center bg-foreground" />
                <span
                  data-testid="path-inline-ghost"
                  className="whitespace-pre text-muted-foreground/40"
                >
                  {flow.pathInlineGhost.text}
                </span>
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
              // A pasted repo link is already complete — arm the repo step to
              // continue straight to the clone destination.
              onPaste={flow.notePastedInput}
              placeholder={placeholder}
              disabled={flow.busy}
              spellCheck={false}
              autoComplete="off"
              className={cn(
                'relative h-10 w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60',
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
                // not the dialog step. React's synthetic event does not carry
                // `isComposing`, so read it off the native event; keyCode 229 covers
                // older engines that omit the flag entirely.
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
                  if (e.shiftKey && flow.isPathStep) {
                    if (!flow.busy) flow.commitCurrentPath()
                    return
                  }
                  if (flow.canSubmit) flow.submit()
                  return
                }
                if (e.key === 'Backspace' && flow.query === '' && step.kind !== 'source') {
                  e.preventDefault()
                  flow.goBack()
                }
              }}
            />
          </div>
          {flow.isPathStep && (
            <Button
              type="button"
              size="sm"
              className="h-7 shrink-0 gap-1.5 px-2.5 text-xs"
              tabIndex={-1}
              disabled={flow.busy || !flow.canSubmit}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => flow.commitCurrentPath()}
            >
              {flow.busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <>
                  <span className="capitalize">{confirmLabel}</span>
                  <span className="rounded bg-primary-foreground/20 px-1 py-px text-[10px] font-medium leading-none">
                    ⇧↵
                  </span>
                </>
              )}
            </Button>
          )}
          {!flow.isPathStep && flow.busy ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : null}
        </div>

        {step.kind === 'destination' && (
          <div className="shrink-0 border-b px-3 py-2">
            <div className="pb-1 text-xs font-medium text-muted-foreground">
              {t('sidebar.addProject.repository')}
            </div>
            <div className="flex items-center gap-2">
              {/* Sized against the two-line title+URL block beside it, not the
                  16px list-row icons — a size-4 avatar reads as a stray dot. */}
              <span className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
                {(() => {
                  const ref =
                    step.source === 'github' ? parseGitHubRepoInput(step.repoInput) : null
                  return ref ? (
                    <GithubOwnerAvatar owner={ref.owner} className="size-8 rounded-md" />
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
                checked={flow.shallowClone}
                disabled={flow.busy}
                onCheckedChange={(value) => flow.setShallowClone(value === true)}
              />
              <span className="min-w-0 leading-snug">
                {t('sidebar.addProject.shallowClone')}
              </span>
            </label>
            <label className="mt-1.5 flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
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
        <div
          className="min-h-0 flex-1 overflow-y-auto p-1"
          onScroll={(e) => {
            if (step.kind !== 'repo' || step.source !== 'github') return
            if (!flow.isGithubMyReposMode || !flow.githubHasMore) return
            const el = e.currentTarget
            if (el.scrollHeight - el.scrollTop - el.clientHeight < 96) {
              flow.loadMoreGithubRepos()
            }
          }}
        >
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
            flow.repoResolved && flow.githubUrlQuery ? (
              // Paste of a full GitHub URL — same card shape as a search hit.
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
                {(() => {
                  const ref = parseGitHubRepoInput(flow.query)
                  return (
                    <>
                      {ref ? (
                        <GithubOwnerAvatar owner={ref.owner} className="size-8 rounded-md" />
                      ) : (
                        <GithubIcon className="size-8 text-muted-foreground" />
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
            ) : listSections.length > 0 ? (
              <>
                <AddProjectList
                  sections={listSections}
                  selectedIndex={flow.selectedIndex}
                  onActivate={flow.activateItem}
                  onHover={flow.setSelectedIndex}
                />
                {flow.githubLoadingMore ? (
                  <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t('common.loading')}
                  </div>
                ) : null}
              </>
            ) : flow.githubLoading ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t('common.loading')}
              </div>
            ) : flow.repoResolved ? (
              // Typed owner/repo with no search hits — still allow continue via resolve.
              <div className="flex h-full min-h-[8rem] flex-col items-center justify-center gap-2 px-6 text-center text-xs text-muted-foreground">
                {(() => {
                  const ref = parseGitHubRepoInput(flow.query)
                  return (
                    <>
                      {ref ? (
                        <GithubOwnerAvatar owner={ref.owner} className="size-8 rounded-md" />
                      ) : (
                        <GithubIcon className="size-8 text-muted-foreground" />
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
            ) : flow.githubUnavailable ? (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {t('sidebar.addProject.githubNeedCli')}
              </div>
            ) : (
              <div className="flex h-full min-h-[8rem] items-center justify-center px-3 text-center text-xs text-muted-foreground">
                {flow.githubSearchOwner || flow.isGithubMyReposMode
                  ? t('sidebar.addProject.githubNoRepos')
                  : t('sidebar.addProject.repoInvalidGithub')}
              </div>
            )
          ) : flow.browseLoading && flow.itemCount === 0 ? (
            <div className="flex h-full min-h-[8rem] items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('common.loading')}
            </div>
          ) : listSections.length > 0 ? (
            <AddProjectList
              sections={listSections}
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
            </>
          )}
          {enterHint ? (
            <>
              {flow.isPathStep ? <span className="mx-1.5">&middot;</span> : null}
              <Kbd>↵</Kbd> {enterHint}
            </>
          ) : null}
          {flow.itemCount > 0 && (
            <>
              {(flow.isPathStep || enterHint) ? <span className="mx-1.5">&middot;</span> : null}
              <Kbd>↑↓</Kbd> {t('sidebar.addProject.hintNav')}
            </>
          )}
          {(step.kind === 'repo' || step.kind === 'destination') && (
            <>
              <span className="mx-1.5">&middot;</span>
              <Kbd>⌫</Kbd> {t('sidebar.addProject.hintBack')}
            </>
          )}
          {confirmHintKey ? (
            <>
              <span className="mx-1.5">&middot;</span>
              <Kbd>⇧↵</Kbd> {t(confirmHintKey)}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

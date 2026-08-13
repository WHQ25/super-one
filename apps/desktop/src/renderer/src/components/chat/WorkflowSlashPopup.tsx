import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleStop, Pause, Play, Save, Workflow } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { HighlightedText } from '@superone/ui/components/ui/HighlightedText'
import { Kbd } from '@superone/ui/components/ui/kbd'
import type { SlashCommandInfo } from '@superone/shared/agent-types'
import { useActiveSession, useSessionScope, getActiveSessionView, useChatStore } from '@/stores/chat'
import { useEffectiveProjectRoot } from '@/stores/app'
import {
  applyWorkflowSuggestion,
  buildWorkflowSuggestItems,
  catalogWorkflows,
  groupWorkflowSuggestItems,
  parseWorkflowSlashPhase,
  resolveWorkflowArgsTip,
  sessionRunNames,
  type WorkflowCatalogEntry,
  type WorkflowSuggestItem,
} from './workflow-slash-suggest'
import type { WorkflowArgSpec } from '@superone/shared/workflow-args'
import { computeBackgroundActivitySignature } from './ChatStatusBar'
import {
  applyKeyWithDefault,
  extractArgsTail,
  formatCliDefault,
  inferArgKind,
  parseCliArgsTail,
  presentCliKeys,
  suggestCliKeys,
  tabOutOfValue,
  type CliApplyResult,
} from './workflow-cli-args'
import { setWorkflowArgSpecs } from './workflow-arg-specs-cache'

export interface WorkflowApplyPayload {
  line: string
  /** Character offsets into `line` to select after apply (value region). */
  selectFrom?: number
  selectTo?: number
}

export interface WorkflowSlashPopupHandle {
  confirmTab: () => void
  confirmEnter: () => void
  getItemCount: () => number
}

interface WorkflowSlashPopupProps {
  argsText: string
  selectedIndex: number
  onSetSelectedIndex: (index: number) => void
  onApply: (payload: string | WorkflowApplyPayload) => void
  slashCommands: SlashCommandInfo[]
}

interface DiscoveredWorkflow {
  name: string
  description: string
  whenToUse?: string
  source: 'project' | 'user'
  path: string
  args: WorkflowArgSpec[]
  exampleJson?: string
}

const ICON_CLS = 'size-3 shrink-0'

function itemIcon(item: WorkflowSuggestItem) {
  if (item.kind === 'op') {
    switch (item.name) {
      case 'pause':
        return <Pause className={ICON_CLS} />
      case 'resume':
        return <Play className={ICON_CLS} />
      case 'stop':
        return <CircleStop className={ICON_CLS} />
      case 'save':
        return <Save className={ICON_CLS} />
      default:
        return <Workflow className={ICON_CLS} />
    }
  }
  return null
}

function sourceLabel(item: WorkflowSuggestItem, t: (k: string, d: string) => string): string {
  if (item.kind === 'run') return t('chat.workflowSlash.session', 'session')
  const src = item.source ?? 'workflow'
  if (src === 'builtin') return t('chat.workflowSlash.builtin', 'builtin')
  if (src === 'project') return t('chat.workflowSlash.project', 'project')
  if (src === 'user') return t('chat.workflowSlash.user', 'user')
  return src
}

/** Display manage ops in Title Case; command text stays lowercase. */
function displayItemName(item: WorkflowSuggestItem): string {
  if (item.kind === 'op' && item.name.length > 0) {
    return item.name.charAt(0).toUpperCase() + item.name.slice(1)
  }
  return item.name
}

function statusLabel(status: WorkflowSuggestItem['status'], t: (k: string, d: string) => string): string | null {
  if (status === 'running') return t('chat.workflowSlash.running', 'running')
  if (status === 'complete') return t('chat.workflowSlash.complete', 'done')
  return null
}

function emitApply(
  onApply: WorkflowSlashPopupProps['onApply'],
  result: CliApplyResult | string,
) {
  if (typeof result === 'string') {
    onApply(result)
    return
  }
  onApply(result)
}

export const WorkflowSlashPopup = forwardRef<WorkflowSlashPopupHandle, WorkflowSlashPopupProps>(
  function WorkflowSlashPopup(
    { argsText, selectedIndex, onSetSelectedIndex, onApply, slashCommands },
    ref,
  ) {
    const { t } = useTranslation()
    const scope = useSessionScope()
    const projectRoot = useEffectiveProjectRoot()
    const activeProject = useChatStore((s) => s.activeProject)
    const cwd = projectRoot || activeProject
    const activitySignature = useActiveSession((s) => computeBackgroundActivitySignature(s.messages))
    const taskProgress = useActiveSession((s) => s.taskProgress)
    const itemRefs = useRef<Map<number, HTMLButtonElement>>(new Map())

    const phase = useMemo(() => parseWorkflowSlashPhase(argsText), [argsText])

    const [discovered, setDiscovered] = useState<DiscoveredWorkflow[]>([])
    const [discoverError, setDiscoverError] = useState<string | null>(null)

    useEffect(() => {
      let cancelled = false
      void (async () => {
        try {
          const rows = await window.app.discoverGrokWorkflows?.(cwd ?? null)
          if (cancelled) return
          setDiscovered(Array.isArray(rows) ? rows : [])
          setDiscoverError(null)
        } catch (err) {
          if (cancelled) return
          setDiscovered([])
          setDiscoverError(err instanceof Error ? err.message : String(err))
        }
      })()
      return () => { cancelled = true }
    }, [cwd])

    const acpCatalog = useMemo(() => catalogWorkflows(slashCommands), [slashCommands])

    const catalog: WorkflowCatalogEntry[] = useMemo(() => {
      const byName = new Map<string, WorkflowCatalogEntry>()
      for (const d of discovered) {
        byName.set(d.name, {
          name: d.name,
          description: d.description,
          source: d.source,
          path: d.path,
          argumentHint: d.args.length > 0
            ? d.args.map((a) => `${a.name}=…`).join(' ')
            : undefined,
        })
      }
      for (const a of acpCatalog) {
        if (!byName.has(a.name)) byName.set(a.name, a)
        else {
          const cur = byName.get(a.name)!
          if (!cur.description && a.description) {
            byName.set(a.name, { ...cur, description: a.description })
          }
        }
      }
      return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
    }, [discovered, acpCatalog])

    const hintsByName = useMemo(() => {
      const map: Record<string, { whenToUse?: string; args: WorkflowArgSpec[]; exampleJson?: string }> = {}
      for (const d of discovered) {
        map[d.name] = {
          whenToUse: d.whenToUse,
          args: d.args,
          exampleJson: d.exampleJson,
        }
        setWorkflowArgSpecs(d.name, d.args)
      }
      return map
    }, [discovered])

    const runs = useMemo(() => {
      const messages = getActiveSessionView(scope).messages
      return sessionRunNames(messages, taskProgress)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activitySignature, taskProgress, scope])

    const listItems = useMemo(
      () => buildWorkflowSuggestItems(phase, { catalog, runs }),
      [phase, catalog, runs],
    )
    const orderedListItems = useMemo(() => {
      const groups = groupWorkflowSuggestItems(listItems)
      return groups.flatMap((g) => g.items)
    }, [listItems])
    const groups = useMemo(() => groupWorkflowSuggestItems(orderedListItems), [orderedListItems])

    const argsTip = useMemo(
      () => resolveWorkflowArgsTip(
        phase,
        catalog,
        phase.afterName ? hintsByName[phase.afterName] : null,
      ),
      [phase, catalog, hintsByName],
    )

    const cliTail = useMemo(() => {
      if (!phase.afterName) return ''
      return extractArgsTail(argsText, phase.afterName)
    }, [argsText, phase.afterName])

    const argSpecs = useMemo(
      () => (phase.afterName ? (hintsByName[phase.afterName]?.args ?? []) : []),
      [phase.afterName, hintsByName],
    )

    const keySuggestions = useMemo(() => {
      if (!phase.afterName || argSpecs.length === 0) return []
      return suggestCliKeys(cliTail, argSpecs)
    }, [phase.afterName, cliTail, argSpecs])

    const presentKeys = useMemo(() => presentCliKeys(cliTail), [cliTail])
    const cliParsed = useMemo(() => parseCliArgsTail(cliTail), [cliTail])

    // In args mode the selectable rows are remaining keys; otherwise workflow/manage list.
    const inArgsMode = Boolean(phase.afterName && !phase.afterOp)
    const itemCount = inArgsMode ? keySuggestions.length : orderedListItems.length
    const safeIndex = itemCount === 0 ? 0 : Math.max(0, Math.min(selectedIndex, itemCount - 1))

    useEffect(() => {
      if (selectedIndex >= itemCount && itemCount > 0) onSetSelectedIndex(0)
    }, [itemCount, selectedIndex, onSetSelectedIndex])

    useEffect(() => {
      itemRefs.current.get(safeIndex)?.scrollIntoView({ block: 'nearest' })
    }, [safeIndex, itemCount, inArgsMode])

    const applyCli = (result: CliApplyResult) => {
      emitApply(onApply, result)
    }

    const confirmKey = (spec: WorkflowArgSpec) => {
      if (!phase.afterName) return
      applyCli(applyKeyWithDefault(phase.afterName, argsText, spec))
      onSetSelectedIndex(0)
    }

    const confirmTab = () => {
      if (inArgsMode && phase.afterName) {
        const trailing = cliParsed.trailing
        // After a completed key=value (value selected or caret in value): Tab out to
        // "expect next key" position — do not auto-fill the next key.
        if (trailing.kind === 'inValue') {
          applyCli(tabOutOfValue(phase.afterName, argsText))
          onSetSelectedIndex(0)
          return
        }
        // Already at key-match position (trailing space / empty): Tab accepts a key.
        if (trailing.kind === 'expectKey' || trailing.kind === 'empty') {
          if (keySuggestions.length > 0) {
            confirmKey(keySuggestions[safeIndex] ?? keySuggestions[0]!)
          }
          return
        }
        // Partial key: complete the highlighted / best match.
        if (trailing.kind === 'partialKey') {
          if (keySuggestions.length > 0) {
            confirmKey(keySuggestions[safeIndex] ?? keySuggestions[0]!)
          }
          return
        }
        return
      }
      // List mode: fill selected workflow / op
      const item = orderedListItems[safeIndex]
      if (!item) return
      onApply(applyWorkflowSuggestion(phase, item))
    }

    const confirmEnter = () => {
      if (inArgsMode) return // let ChatInput send
      const item = orderedListItems[safeIndex]
      if (!item) return
      onApply(applyWorkflowSuggestion(phase, item))
    }

    useImperativeHandle(
      ref,
      () => ({
        getItemCount: () => itemCount,
        confirmTab,
        confirmEnter,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [itemCount, safeIndex, orderedListItems, phase, inArgsMode, keySuggestions, cliParsed, argSpecs, argsText],
    )

    const title = phase.afterOp
      ? t('chat.workflowSlash.pickRun', 'Pick a run')
      : phase.afterName
        ? t('chat.workflowSlash.afterName', 'Args')
        : t('chat.workflowSlash.pickNameOrOp', 'Launch or Manage')

    const showEmpty = phase.done && !argsTip
    const showListEmpty = !phase.done && itemCount === 0 && !argsTip && !inArgsMode

    if (showEmpty || showListEmpty) {
      return (
        <div className="absolute bottom-full left-0 right-0 z-10 mb-1 overflow-hidden rounded-xl border border-border bg-popover">
          <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
            <span className="text-xs font-medium text-muted-foreground">/workflow</span>
            <span className="text-xs text-muted-foreground/70">{title}</span>
          </div>
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            {discoverError
              ? discoverError
              : phase.done
                ? t('chat.workflowSlash.ready', 'Ready to send')
                : phase.afterOp
                  ? t('chat.workflowSlash.noRuns', 'No workflow runs in this session')
                  : t('chat.workflowSlash.empty', 'No matching workflows')}
          </div>
          {phase.done && (
            <div className="z-10 border-t border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground">
              <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
                <Kbd>↵</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.launch', 'launch')}</span>
                <Kbd>esc</Kbd>
                <span>{t('chat.workflowSlash.close', 'close')}</span>
              </div>
            </div>
          )}
        </div>
      )
    }

    let flatIdx = 0

    return (
      <div className="absolute bottom-full left-0 right-0 z-10 mb-1 flex max-h-[50vh] flex-col overflow-hidden rounded-xl border border-border bg-popover">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-1.5">
          <span className="text-xs font-medium text-muted-foreground">/workflow</span>
          <span className="text-xs text-muted-foreground/70">{title}</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {argsTip && (
            <div className={cn('px-3 py-2', (itemCount > 0 || inArgsMode) && keySuggestions.length > 0 && 'border-b border-border')}>
              <div className="flex min-w-0 items-center gap-1.5 leading-4">
                <Workflow className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate text-xs font-medium text-foreground">{argsTip.name}</span>
                {argsTip.source && (
                  <span className="shrink-0 rounded bg-muted/60 px-1 py-px text-2xs uppercase tracking-wide text-muted-foreground">
                    {argsTip.source}
                  </span>
                )}
              </div>
              {argsTip.description && (
                <p className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
                  {argsTip.description}
                </p>
              )}
              {argsTip.whenToUse && (
                <p className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground/70">
                  {argsTip.whenToUse}
                </p>
              )}
            </div>
          )}

          {/* Args mode: remaining keys to Tab-complete */}
          {inArgsMode && keySuggestions.length > 0 && (
            <div className="p-1">
              <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground/80">
                {t('chat.workflowSlash.keys', 'Keys')}
              </div>
              {keySuggestions.map((spec, i) => {
                const kind = inferArgKind(spec)
                const def = formatCliDefault(spec)
                return (
                  <button
                    key={spec.name}
                    type="button"
                    ref={(el) => {
                      if (el) itemRefs.current.set(i, el)
                      else itemRefs.current.delete(i)
                    }}
                    onMouseEnter={() => onSetSelectedIndex(i)}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      confirmKey(spec)
                    }}
                    className={cn(
                      'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                      i === safeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 leading-4">
                      <code className="shrink-0 rounded bg-muted/70 px-1 py-px font-mono text-xs">
                        {spec.name}=
                      </code>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {def}
                      </span>
                      <span className="shrink-0 text-2xs uppercase tracking-wide text-muted-foreground/70">
                        {kind}
                      </span>
                      {presentKeys.has(spec.name) && (
                        <span className="shrink-0 text-2xs text-primary/80">set</span>
                      )}
                    </span>
                    {spec.description && (
                      <span className="line-clamp-1 leading-snug text-muted-foreground">
                        {spec.description}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          )}

          {/* Launch / manage list */}
          {!inArgsMode && orderedListItems.length > 0 && (
            <div className="p-1">
              {groups.map((group) => (
                <div key={group.key} className="mb-0.5">
                  <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-muted-foreground/80">
                    {group.key === 'op'
                      ? t('chat.workflowSlash.sectionManage', 'Manage')
                      : group.key === 'workflow'
                        ? t('chat.workflowSlash.sectionLaunch', 'Workflows')
                        : t('chat.workflowSlash.sectionRuns', 'Session runs')}
                  </div>
                  {group.items.map((item) => {
                    const i = flatIdx++
                    const status = statusLabel(item.status, (k, d) => t(k, d))
                    return (
                      <button
                        key={item.id}
                        type="button"
                        ref={(el) => {
                          if (el) itemRefs.current.set(i, el)
                          else itemRefs.current.delete(i)
                        }}
                        onMouseEnter={() => onSetSelectedIndex(i)}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          onApply(applyWorkflowSuggestion(phase, item))
                        }}
                        className={cn(
                          'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                          i === safeIndex ? 'bg-accent text-accent-foreground' : 'hover:bg-muted/60',
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 leading-4">
                          {item.kind === 'op' && (
                            <span className="inline-flex shrink-0 text-muted-foreground">
                              {itemIcon(item)}
                            </span>
                          )}
                          <HighlightedText
                            text={displayItemName(item)}
                            indices={item.matchIndices}
                            highlightClassName="text-highlighted font-semibold"
                            className="min-w-0 truncate font-medium leading-4"
                          />
                          {/* Manage ops already sit in the Manage section — no redundant badge. */}
                          {item.kind !== 'op' && (
                            <span className="shrink-0 rounded bg-muted px-1 py-px text-2xs uppercase tracking-wide text-muted-foreground">
                              {sourceLabel(item, (k, d) => t(k, d))}
                            </span>
                          )}
                          {status && (
                            <span
                              className={cn(
                                'shrink-0 rounded px-1 py-px text-2xs uppercase tracking-wide',
                                item.status === 'running'
                                  ? 'bg-primary/15 text-primary'
                                  : 'bg-muted text-muted-foreground',
                              )}
                            >
                              {status}
                            </span>
                          )}
                        </span>
                        {item.description && (
                          <span className="line-clamp-1 leading-snug text-muted-foreground">
                            {item.description}
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="z-10 shrink-0 border-t border-border bg-popover px-2 py-1.5 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
            {inArgsMode ? (
              <>
                <Kbd>tab</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.tabKey', 'complete / out')}</span>
                <Kbd>↵</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.launch', 'launch')}</span>
                <Kbd>esc</Kbd>
                <span>{t('chat.workflowSlash.close', 'close')}</span>
              </>
            ) : itemCount > 0 ? (
              <>
                <Kbd>↑↓</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.nav', 'nav')}</span>
                <Kbd>tab</Kbd>
                <span className="text-muted-foreground/50">/</span>
                <Kbd>↵</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.fill', 'fill')}</span>
                <Kbd>esc</Kbd>
                <span>{t('chat.workflowSlash.close', 'close')}</span>
              </>
            ) : (
              <>
                <Kbd>↵</Kbd>
                <span className="mr-1">{t('chat.workflowSlash.launch', 'launch')}</span>
                <Kbd>esc</Kbd>
                <span>{t('chat.workflowSlash.close', 'close')}</span>
              </>
            )}
          </div>
        </div>
      </div>
    )
  },
)

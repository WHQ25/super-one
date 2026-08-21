import { useMemo, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ClipboardList, ShieldCheck } from 'lucide-react'
import { cn } from '@superone/ui/lib/utils'
import { getStallColor, type StallLevel } from '@/lib/stall-utils'
import { FileChip } from './FileChip'
import {
  findingFileName,
  parseReportFindings,
  type ReviewFinding,
} from './report-findings-display'
import {
  CompactLabeledToolRow,
  ToolName,
  ToolRow,
  ToolSummary,
  withStreamingEllipsis,
} from './tool-row'

interface ReportFindingsToolBlockProps {
  params: Record<string, unknown>
  isStreaming: boolean
  isError?: boolean
  isDenied?: boolean
  elapsedSeconds?: number
  stallLevel: StallLevel
  /** When false, header-only (subagent card). Default true. */
  allowExpand?: boolean
}

/**
 * A confirmed defect earns a filled dot; a plausible one stays an outline.
 *
 * The verifier's confidence is the difference between "go fix this" and "go look at
 * this", and it is the only field the summary text cannot carry — so it gets the
 * one piece of ink at the start of the row instead of a word at the end of it.
 */
function VerdictDot({ finding }: { finding: ReviewFinding }) {
  const { t } = useTranslation()
  if (!finding.verdict) return <span className="size-1.5 shrink-0" />
  const confirmed = finding.verdict === 'CONFIRMED'
  return (
    <span
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        confirmed ? 'bg-warning' : 'border border-muted-foreground/60',
      )}
      title={t(`chat.toolBlock.reportFindings.verdict.${confirmed ? 'confirmed' : 'plausible'}`)}
    />
  )
}

function OutcomeBadge({ finding }: { finding: ReviewFinding }) {
  const { t } = useTranslation()
  if (!finding.outcome) return null
  const key = finding.outcome === 'no_change_needed' ? 'noChangeNeeded' : finding.outcome
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 py-px text-[11px]',
        finding.outcome === 'fixed'
          ? 'bg-success/15 text-success'
          : 'bg-muted/60 text-muted-foreground',
      )}
    >
      {t(`chat.toolBlock.reportFindings.outcome.${key}`)}
    </span>
  )
}

function FindingItem({ finding, index }: { finding: ReviewFinding; index: number }) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const title = finding.shortSummary || finding.summary
  // `short_summary` is the claim with the rationale stripped, so the full sentence is
  // still worth showing once opened. When the agent skipped it they are the same
  // string, and repeating it would read as a bug.
  const showSummary = !!finding.summary && finding.summary !== title
  const expandable = showSummary || !!finding.failureScenario

  return (
    <div className="rounded px-1.5 py-1 transition-colors hover:bg-muted/40">
      {/* The claim toggles the row; the file chip below stays its own target, so
          opening the file and opening the detail never fight over one click. */}
      <button
        type="button"
        disabled={!expandable}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          setExpanded((value) => !value)
        }}
        className={cn(
          'flex w-full min-w-0 items-center gap-1.5 text-left',
          expandable && 'cursor-pointer',
        )}
      >
        {/* Rank, not an ID: the tool contract orders findings most-severe first. */}
        <span className="w-3 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground/60">
          {index + 1}
        </span>
        <VerdictDot finding={finding} />
        <span className="min-w-0 flex-1 truncate text-foreground" title={finding.summary || title}>
          {title}
        </span>
        <OutcomeBadge finding={finding} />
        {expandable ? (
          <ChevronRight
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform duration-200',
              expanded && 'rotate-90',
            )}
          />
        ) : null}
      </button>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-[1.375rem]">
        {finding.file ? (
          <FileChip
            name={findingFileName(finding.file)}
            title={finding.line != null ? `${finding.file}:${finding.line}` : finding.file}
            filePath={finding.file}
            lineNumber={finding.line}
            className="text-xs"
          />
        ) : null}
        {finding.category ? (
          <span className="shrink-0 rounded bg-muted/60 px-1 text-[11px] text-muted-foreground">
            {finding.category}
          </span>
        ) : null}
      </div>
      {expandable ? (
        <div
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="flex flex-col gap-1 pb-1 pl-[1.375rem] pt-1 text-xs">
              {showSummary ? <span className="text-foreground/90">{finding.summary}</span> : null}
              {finding.failureScenario ? (
                <span className="text-muted-foreground">
                  <span className="text-muted-foreground/60">
                    {t('chat.toolBlock.reportFindings.failureScenario')}{' '}
                  </span>
                  {finding.failureScenario}
                </span>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * The review's findings, as the review's only output.
 *
 * `ReportFindings` is called once per review and the agent is told not to also print
 * the findings as prose — so this block is the whole result, not a log line about it.
 * That is why it opens expanded: a collapsed row would hide the entire deliverable
 * behind a chevron.
 */
export function ReportFindingsToolBlock({
  params,
  isStreaming,
  isError,
  isDenied,
  elapsedSeconds,
  stallLevel,
  allowExpand = true,
}: ReportFindingsToolBlockProps) {
  const { t } = useTranslation()
  const info = useMemo(() => parseReportFindings(params), [params])

  const tone = isDenied ? 'denied' : isError ? 'error' : 'default'
  const failed = isDenied || isError
  const clean = info.clean && !isStreaming && !failed
  const count = info.findings.length

  const label = withStreamingEllipsis(
    isStreaming
      ? t('chat.toolBlock.reportFindings.reporting')
      : t('chat.toolBlock.reportFindings.title'),
    isStreaming,
  )
  const icon = clean
    ? <ShieldCheck className="size-3 shrink-0 text-success" />
    : <ClipboardList className="size-3 shrink-0 text-muted-foreground" />

  if (!allowExpand) {
    return (
      <CompactLabeledToolRow
        icon={icon}
        label={label}
        summary={clean ? t('chat.toolBlock.reportFindings.noFindings') : undefined}
        streaming={isStreaming}
        tone={tone}
      />
    )
  }

  // The count is the headline; the top finding is what the count is about. Together
  // they let a collapsed row still say something true.
  const summary = clean
    ? t('chat.toolBlock.reportFindings.noFindings')
    : count > 0
      ? (info.findings[0].shortSummary || info.findings[0].summary)
      : undefined

  return (
    <ToolRow
      icon={icon}
      tone={tone}
      expandable={count > 0}
      defaultExpanded
      detailsClassName="border-t border-border/40 px-1 py-1 text-xs"
      details={count > 0 ? (
        <div className="flex flex-col">
          {info.findings.map((finding, index) => (
            <FindingItem
              key={`${finding.file}:${finding.line ?? ''}:${index}`}
              finding={finding}
              index={index}
            />
          ))}
        </div>
      ) : undefined}
      trailing={(
        <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground/70">
          {info.level ? (
            <span title={t('chat.toolBlock.reportFindings.levelHint')}>
              {t(`chat.toolBlock.reportFindings.level.${info.level}`)}
            </span>
          ) : null}
          {count > 0 ? (
            <span>{t('chat.toolBlock.reportFindings.findingCount', { count })}</span>
          ) : null}
          {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 ? (
            <span className={cn('transition-colors duration-500', getStallColor(stallLevel))}>
              {Math.round(elapsedSeconds)}s
            </span>
          ) : null}
        </div>
      )}
    >
      <ToolName streaming={isStreaming && !isDenied} tone={tone}>{label}</ToolName>
      {summary ? <ToolSummary>{summary}</ToolSummary> : null}
      {/* Eats the slack so the count and the chevron sit together on the right; two
          `ml-auto` siblings would split it between them instead. */}
      <span className="flex-1" />
    </ToolRow>
  )
}

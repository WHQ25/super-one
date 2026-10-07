import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { patchToolFiles, summarizePatchToolFiles, type PatchToolFile } from '@superone/shared/patch-tool'
import type { ReactNode } from 'react'
import type { GenericToolRowProps } from './GenericToolRow'
import { parseToolInput } from './tool-display'
import { ToolIcon } from './ToolIcon'
import { ToolErrorText, ToolName, ToolRow, ToolSummary, toolOutcomeLabel, toolRowTone } from './ToolRow'

function SourceText({ text }: { text: string }) {
  return <pre className="max-h-60 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all"><code>{text}</code></pre>
}

function outcome(result: string | undefined, isError: boolean | undefined) {
  const denied = result?.startsWith('[denied] ') === true
  return { denied, tone: toolRowTone(denied, isError), result: denied ? result!.slice('[denied] '.length) : result }
}

function useExpansion(initial: boolean | undefined, onChange: GenericToolRowProps['onExpandedChange']) {
  const [expanded, setExpanded] = useState(initial ?? false)
  // Match GenericToolRow: a remote row opened by navigation must fetch detail
  // on mount too, not only after a header click.
  useEffect(() => { onChange?.(expanded) }, [expanded, onChange])
  return { expanded, onExpandedChange: setExpanded }
}

/** The same multi-file change row on desktop and phone; only file/diff ports differ. */
export function PatchToolRow(props: GenericToolRowProps & { renderFileTool: (file: PatchToolFile, index: number) => ReactNode }) {
  const { t } = useTranslation()
  const params = useMemo(() => parseToolInput(props.input, props.toolName), [props.input, props.toolName])
  const files = useMemo(() => patchToolFiles(params), [params])
  const totals = useMemo(() => summarizePatchToolFiles(files), [files])
  const { denied, tone, result } = outcome(props.result, props.isError)
  const streaming = props.status === 'streaming'
  const interrupted = denied || !!props.isError
  const expansion = useExpansion(props.allowExpand && (props.defaultExpanded ?? props.autoExpand ?? props.defaultAutoExpand ?? props.autoExpandFileDiffs), props.onExpandedChange)
  const collapsed = !props.allowExpand || !expansion.expanded
  const label = toolOutcomeLabel({
    streaming, interrupted,
    streamingLabel: t('chat.toolBlock.nativeCode.applyingPatch'),
    actionLabel: t('chat.toolBlock.nativeCode.applyPatch'),
    doneLabel: t('chat.toolBlock.nativeCode.patchApplied'),
  })
  const details = <div className="space-y-2">
    {props.detailStatus && <div role="status">{props.detailStatus}{props.onDetailRetry && <button type="button" className="ml-2 underline" onClick={props.onDetailRetry}>{t('common.retry')}</button>}</div>}
    {!interrupted && files.length > 0 && <div className="max-h-96 space-y-0.5 overflow-y-auto">
      {files.map((file, index) => <div key={`${file.path}:${index}`}>{props.renderFileTool(file, index)}</div>)}
    </div>}
    {files.length === 0 && typeof params.patchText === 'string' && <SourceText text={params.patchText} />}
    {result && (interrupted ? <ToolErrorText className={denied ? 'text-error/70' : undefined}>{result}</ToolErrorText> : files.length === 0 ? props.ports.renderJson(result) : <details className="text-muted-foreground">
      <summary className="cursor-pointer py-1">{t('chat.toolBlock.nativeCode.output')}</summary>
      {props.ports.renderJson(result)}
    </details>)}
  </div>
  return <div data-tool-use-id={props.toolUseId}>
    <ToolRow icon={<ToolIcon icon="file-edit" className="size-3 shrink-0 text-muted-foreground" />} tone={tone}
      expandable={props.allowExpand && (files.length > 0 || !!result || !!props.hasDeferredDetails || typeof params.patchText === 'string')}
      details={details} detailsClassName="border-t border-border/30 px-1.5 py-1 text-xs" mountDetails="expanded" {...expansion}
      trailing={props.trailing ?? (streaming && props.elapsedSeconds ? <span className="text-muted-foreground">{props.elapsedSeconds}s</span> : undefined)}>
      <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
      {totals.files > 0 && <ToolSummary>{totals.files === 1 ? t('chat.toolBlock.nativeCode.oneFile') : t('chat.toolBlock.nativeCode.fileCount', { count: totals.files })}</ToolSummary>}
      {!interrupted && collapsed && (totals.added > 0 || totals.removed > 0) && <span className="flex shrink-0 items-center gap-1 text-xs tabular-nums">
        {totals.approximate && <span className="text-muted-foreground">≈</span>}
        {totals.added > 0 && <span className="text-success">+{totals.added.toLocaleString()}</span>}
        {totals.removed > 0 && <span className="text-error">-{totals.removed.toLocaleString()}</span>}
      </span>}
    </ToolRow>
  </div>
}

/** Code Mode is JavaScript/tool orchestration, not a shell command. Never evaluate its source here. */
export function CodeExecutionToolRow(props: GenericToolRowProps) {
  const { t } = useTranslation()
  const params = useMemo(() => parseToolInput(props.input, props.toolName), [props.input, props.toolName])
  const code = typeof params.code === 'string' ? params.code : ''
  const { denied, tone, result } = outcome(props.result, props.isError)
  const streaming = props.status === 'streaming'
  const expansion = useExpansion(props.allowExpand && props.defaultExpanded, props.onExpandedChange)
  const label = toolOutcomeLabel({
    streaming, interrupted: denied || !!props.isError,
    streamingLabel: t('chat.toolBlock.nativeCode.executingCode'),
    actionLabel: t('chat.toolBlock.nativeCode.executeCode'),
    doneLabel: t('chat.toolBlock.nativeCode.codeExecuted'),
  })
  const details = <div className="space-y-2">
    {props.detailStatus && <div role="status">{props.detailStatus}{props.onDetailRetry && <button type="button" className="ml-2 underline" onClick={props.onDetailRetry}>{t('common.retry')}</button>}</div>}
    {code && <div><div className="mb-1 text-muted-foreground">{t('chat.toolBlock.nativeCode.source')}</div><SourceText text={code} /></div>}
    {result && <div><div className="mb-1 text-muted-foreground">{t('chat.toolBlock.nativeCode.output')}</div>
      {denied || props.isError ? <ToolErrorText className={denied ? 'text-error/70' : undefined}>{result}</ToolErrorText> : props.ports.renderJson(result)}
    </div>}
  </div>
  return <div data-tool-use-id={props.toolUseId}>
    <ToolRow icon={<ToolIcon icon="code" className="size-3 shrink-0 text-muted-foreground" />} tone={tone}
      expandable={props.allowExpand && (!!code || !!result || !!props.hasDeferredDetails)} details={details}
      mountDetails="expanded" {...expansion}
      trailing={props.trailing ?? (streaming && props.elapsedSeconds ? <span className="text-muted-foreground">{props.elapsedSeconds}s</span> : undefined)}>
      <ToolName streaming={streaming} tone={tone}>{label}</ToolName>
      <ToolSummary>JavaScript</ToolSummary>
    </ToolRow>
  </div>
}

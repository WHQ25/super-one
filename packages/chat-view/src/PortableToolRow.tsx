import { useContext, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@superone/ui/lib/utils'
import { FileIcon } from '@superone/ui/components/ui/FileIcon'
import { requestNative } from './bridge'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableFilesPreviewer } from './PortableFilesPreviewer'
import { PortableNativeGallery } from './PortableNativeGallery'
import { PortableWidgetBlock } from './PortableWidgetBlock'
import { isGalleryPayload, parsePortableNativeWidgetResult } from './portable-native-widget'
import { parseWidgetResult } from '@superone/shared/generative-ui/types'
import { PortableTurnContext } from './portable-turn-context'
import { parseMcpToolName } from './presenters/tool-display'
import { resolveMcpServerIconFromMap } from '@superone/shared/mcp-server-icon'
import {
  GenericToolRowPresenter,
  type FileDiffPresenterProps,
  type GenericToolRowPorts,
  type GenericToolRowProps,
} from './presenters/GenericToolRow'
import { AppToolBlockPresenter } from './presenters/AppToolBlock'
import { FileChipShell } from './presenters/FileChipShell'
import { AnsiText } from './presenters/ansi'
import { ToolIcon } from './presenters/ToolIcon'
import { CompactLabeledToolRow } from './presenters/ToolRow'
import { BashTerminalPresenter } from './presenters/BashTerminalPresenter'
import type { BashEditToolUse } from '@superone/shared/bash-edit-diff'
import { parseNativeDiff, type NativeDiffLine } from './presenters/remote-diff'
import { tryPrettifyJson } from './presenters/tool-block-utils'
import { InputRequestToolRow } from './presenters/InputRequestToolRow'
import type { BashEditDiff, QuestionPreviewFormat } from '@superone/shared/agent-types'

/**
 * File name chip that hands the path to the native host instead of opening a desktop tab.
 * The chrome and the file-type icon are the desktop's, so a tool row reads the same on
 * both surfaces; only the tap target differs: the phone previews the file in place
 * (`previewFile`), the way the desktop opens it in a tab.
 */
function PortableFileChip({ name, title, filePath, className }: { name: string; title: string; filePath: string; className?: string }) {
  return (
    <FileChipShell
      icon={<FileIcon name={filePath.split(/[/\\]/).pop() || name} size={12} />}
      name={name}
      title={title}
      className={className}
      onClick={(e) => { e.stopPropagation(); requestNative('previewFile', { path: filePath }) }}
    />
  )
}

/**
 * Edited-file view for the phone. The WebView never receives `old_string`/`new_string`,
 * so it draws the diff the desktop precomputed — tokens included — rather than re-diffing.
 *
 * The chrome mirrors the desktop `DiffView`: a 300px scroll window, a line-number gutter
 * pinned outside the horizontal scroller, and the same `+`/`-` marker column. The desktop
 * additionally virtualizes its rows; the phone renders them all, so a very large diff still
 * costs a tall DOM even though the row itself no longer grows past 300px.
 */
const DIFF_ROW_TINT: Record<NativeDiffLine['kind'], string> = {
  added: 'bg-green-500/15',
  removed: 'bg-red-500/15',
  context: '',
}

const DIFF_MARKER: Record<NativeDiffLine['kind'], { glyph: string; className: string }> = {
  added: { glyph: '+', className: 'text-green-600/60 dark:text-green-400/60' },
  removed: { glyph: '-', className: 'text-red-600/60 dark:text-red-400/60' },
  context: { glyph: ' ', className: 'text-transparent' },
}

function PortableFileDiff({ toolDiff, toolDiffTokens }: Pick<FileDiffPresenterProps, 'toolDiff' | 'toolDiffTokens'>) {
  const lines = useMemo(() => (toolDiff ? parseNativeDiff(toolDiff, toolDiffTokens) : []), [toolDiff, toolDiffTokens])
  // Matches the desktop gutter: at least two columns, otherwise as wide as the last line.
  const gutterCh = useMemo(
    () => Math.max(2, String(lines.reduce((widest, line) => Math.max(widest, line.line), 0)).length),
    [lines],
  )
  if (lines.length === 0) return null
  return (
    <div className="flex max-h-[300px] overflow-x-hidden overflow-y-auto rounded bg-background/70 py-2 font-mono text-[12px] leading-relaxed text-foreground">
      <div className="shrink-0" style={{ width: `calc(${gutterCh}ch + 1.25rem)` }}>
        {lines.map((line, index) => (
          <div key={index} className={cn('whitespace-pre pr-2', DIFF_ROW_TINT[line.kind])}>
            <span className="inline-block w-full select-none pr-1.5 text-right text-muted-foreground/50">{line.line}</span>
          </div>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <div className="w-max min-w-full">
          {lines.map((line, index) => (
            <div key={index} className={cn('whitespace-pre pr-2', DIFF_ROW_TINT[line.kind])}>
              <span className={cn('mr-1 inline-block w-[1ch] select-none text-center', DIFF_MARKER[line.kind].className)}>
                {DIFF_MARKER[line.kind].glyph}
              </span>
              {line.tokens
                ? line.tokens.map(([text, color], i) => <span key={i} style={color ? { color } : undefined}>{text}</span>)
                : (line.text || ' ')}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function PortableJson({ text }: { text: string }) {
  const pretty = useMemo(() => tryPrettifyJson(text) ?? text, [text])
  return (
    <pre className="max-h-60 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
      {pretty}
    </pre>
  )
}

function noRemoteOutputFile(): Promise<string> {
  // Bash output files live on the desktop's disk; the phone only ever has the
  // truncated tail the transport already delivered.
  return Promise.resolve('')
}

/**
 * The desktop's terminal row, fed from the transport instead of the live output store.
 * `bash_result` carries only the truncated output; the presenter renders the command separately.
 * This is what
 * the presenter falls back to when there is no streaming snapshot.
 */
function PortableBashTool({
  toolUseId,
  input,
  toolSummary,
  result,
  status,
  isError,
  bashEditDiff,
  allowExpand,
  onExpandedChange,
  detailStatus,
  onDetailRetry,
}: {
  toolUseId?: string
  input: string
  toolSummary?: string
  result?: string
  status?: 'streaming' | 'complete'
  isError?: boolean
  bashEditDiff?: BashEditDiff
  allowExpand: boolean
  onExpandedChange?: (expanded: boolean) => void
  detailStatus?: string
  onDetailRetry?: () => void
}) {
  const { pendingPermission } = useContext(PortableTurnContext)
  const params = useMemo(() => {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} as Record<string, unknown> }
  }, [input])
  const command = typeof params.command === 'string' ? params.command : (toolSummary ?? '')
  const description = typeof params.description === 'string' && params.description.trim()
    ? params.description
    : (typeof params.command === 'string' && toolSummary && toolSummary !== params.command ? toolSummary : undefined)
  // Older remote histories include the transport's colored command echo.
  // Match that exact format only: a program may legitimately print `$ command`.
  const legacyEcho = `\x1b[32m$\x1b[0m ${command}`
  const output = command && result?.startsWith(`${legacyEcho}\n`)
    ? result.slice(legacyEcho.length + 1)
    : command && result === legacyEcho ? '' : result
  const isDenied = Boolean(output?.startsWith('[denied] '))
  const isPendingPermission = Boolean(pendingPermission
    && (pendingPermission.toolUseId ? pendingPermission.toolUseId === toolUseId : pendingPermission.toolName === 'Bash'))
  return (
    <BashTerminalPresenter
      toolUseId={toolUseId ?? ''}
      command={command}
      description={description}
      fallbackResult={isDenied ? undefined : output}
      bashOutput={status === 'streaming' && !isDenied && !isPendingPermission
        ? { content: output ?? '', finished: false }
        : undefined}
      isStreaming={status === 'streaming'}
      isDenied={isDenied}
      isError={isError}
      timeoutMs={typeof params.timeout === 'number' ? params.timeout : undefined}
      runInBackground={params.run_in_background === true || params.background === true}
      allowExpand={allowExpand}
      isPendingPermission={isPendingPermission}
      onExpandedChange={onExpandedChange}
      detailStatus={detailStatus}
      onDetailRetry={onDetailRetry}
      readOutputFile={noRemoteOutputFile}
      readOutputMore={noRemoteOutputFile}
      renderAnsiText={(text) => <AnsiText text={text} />}
      bashEditDiff={bashEditDiff}
      renderFileTool={renderPortableBashEditTool}
    />
  )
}

/**
 * A file the Bash command changed, as the Edit / Write / Delete row a direct edit
 * gets. The phone's diff body reads `toolDiff`, not the params, so it is derived
 * here from the synthesized input (unified hunks, or `+` rows for a new file).
 */
function renderPortableBashEditTool(row: BashEditToolUse): ReactNode {
  let toolDiff: string | undefined
  try {
    const params = JSON.parse(row.input) as Record<string, unknown>
    toolDiff = row.toolName === 'Write'
      ? String(params.content ?? '').replace(/\n$/, '').split('\n').map((line) => `+${line}`).join('\n') || undefined
      : typeof params.diff === 'string' ? params.diff : undefined
  } catch {
    toolDiff = undefined
  }
  return <PortableToolRow toolName={row.toolName} toolUseId={row.toolUseId} input={row.input} status="complete" toolDiff={toolDiff} />
}

/**
 * Mini-app tool card for the phone. The app's own WebView renderers are desktop-only —
 * they need the mini-app host process — so this always draws the shared header card, and
 * names the app by its id because manifests never leave the desktop.
 */
function parseMiniAppIdentity(input: string): { appId: string; tool: string } | null {
  try {
    const parsed = JSON.parse(input) as Record<string, unknown>
    const appId = typeof parsed?.appId === 'string' ? parsed.appId : ''
    const tool = typeof parsed?.tool === 'string' ? parsed.tool : ''
    return appId && tool ? { appId, tool } : null
  } catch { return null }
}

/**
 * The desktop's first widget stage. The phone never receives the streamed input
 * (`tool_input_delta` stays on the desktop), so it holds this row until the result
 * lands instead of drawing a partial widget.
 */
function PortableWidgetGenerating() {
  const { t } = useTranslation()
  return (
    <CompactLabeledToolRow
      icon={<ToolIcon icon="widget" className="size-3 shrink-0 text-muted-foreground" />}
      label={t('chat.toolBlock.generatingWidget')}
      streaming
    />
  )
}

function PortableMiniAppTool({
  identity,
  result,
  status,
  allowExpand,
}: {
  identity: { appId: string; tool: string }
  result?: string
  status?: 'streaming' | 'complete'
  allowExpand: boolean
}) {
  const isStreaming = status === 'streaming'
  return (
    <AppToolBlockPresenter
      icon={<ToolIcon icon="plug" className="size-3 shrink-0 text-muted-foreground" />}
      appName={identity.appId}
      toolText={identity.tool.replace(/_/g, ' ')}
      summary=""
      isStreaming={isStreaming}
      expandable={allowExpand && Boolean(result) && !isStreaming}
      result={result}
      renderJson={(text) => <PortableJson text={text} />}
    />
  )
}

/**
 * The desktop's light "paper" for an option's HTML (`.ask-html-preview`): the
 * model writes these fragments for a white page, so they stay readable in a
 * dark theme.
 */
const QUESTION_HTML_PAPER = 'html{background:#f1f5f9;color:#1a202c;color-scheme:light}'
  // The desktop's fragment inherits the form's `text-xs`; a frame starts from 16px.
  + 'body{margin:0;padding:20px;display:flex;justify-content:center;align-items:flex-start;font:12px/16px system-ui,-apple-system,sans-serif}'
  + ':is(img,video,canvas,svg,table){max-width:100%;height:auto}table{border-collapse:collapse}a{color:#2563eb;text-decoration:underline}'

/**
 * An option's HTML in a frame that runs no script. Same-origin only so the
 * host can read its height: with no script inside, the frame can do nothing
 * with it. The form's container caps and scrolls it, as on the desktop.
 */
function QuestionHtmlFrame({ content }: { content: string }) {
  const [height, setHeight] = useState(160)
  return (
    <iframe
      title="Preview"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${QUESTION_HTML_PAPER}</style>${content}`}
      onLoad={(event) => {
        // The body, not the root: a root is never shorter than the frame it fills.
        const body = event.currentTarget.contentDocument?.body
        if (body) setHeight(Math.ceil(body.getBoundingClientRect().height))
      }}
      style={{ height }}
      className="block w-full border-0"
    />
  )
}

/** An option's preview: Markdown in the transcript's renderer, HTML on paper in a frame. */
export function PortableQuestionPreview({ content, format, scheme: own }: { content: string; format: QuestionPreviewFormat; scheme?: 'light' | 'dark' }) {
  const turn = useContext(PortableTurnContext)
  const scheme = own ?? turn.scheme
  if (format === 'html') return <QuestionHtmlFrame key={content} content={content} />
  return <PortableMarkdown text={content} isStreaming={false} scheme={scheme} />
}

/**
 * WebView half of the shared tool row. Everything platform-bound is answered here; the
 * row itself — icon, label, summary, deltas, expansion — is the same code the desktop runs.
 */
const PORTABLE_TOOL_ROW_PORTS: GenericToolRowPorts = {
  // The phone has no project checkout, so paths shorten against `$HOME` only.
  cwd: '',
  homedir: '',
  stallLevel: 'normal',
  preferSentSummary: true,
  renderFileChip: (props) => <PortableFileChip {...props} />,
  renderFileDiff: ({ toolDiff, toolDiffTokens }) => <PortableFileDiff toolDiff={toolDiff} toolDiffTokens={toolDiffTokens} />,
  renderArtifactChip: ({ url, label }) => (
    <button
      type="button"
      className="shrink-0 truncate rounded bg-primary/10 px-1.5 py-0.5 text-xs text-primary"
      onClick={(e) => { e.stopPropagation(); requestNative('openLink', { url }) }}
    >
      {label}
    </button>
  ),
  renderCount: (value) => <>{value}</>,
  renderJson: (text) => <PortableJson text={text} />,
  // Option previews arrive as markdown or as an HTML fragment the WebView will not eval.
  renderQuestionPreview: (preview) => <PortableQuestionPreview {...preview} />,
}

export type PortableToolRowProps = Omit<GenericToolRowProps, 'ports' | 'allowExpand' | 'autoExpandFileDiffs'>
  & { allowExpand?: boolean }

/** The brand icon of the MCP server behind a tool, when the host knows one. */
export function useMcpToolIconSrc(toolName: string): string | undefined {
  const { mcpIcons } = useContext(PortableTurnContext)
  return useMemo(() => {
    const info = parseMcpToolName(toolName)
    return info ? resolveMcpServerIconFromMap(info.serverName, mcpIcons) : undefined
  }, [mcpIcons, toolName])
}

export function PortableToolRow({ allowExpand = true, ...props }: PortableToolRowProps) {
  // The desktop mounts `WidgetBlock` for a settled widget call; the phone renders the
  // same payload natively, so the short-circuit lives here rather than in the shared row.
  const miniApp = useMemo(
    () => (props.toolName === 'mcp__superone__miniapp_call' ? parseMiniAppIdentity(props.input) : null),
    [props.toolName, props.input],
  )
  const isWidgetTool = props.toolName === 'mcp__superone__widget_show'
  const nativeWidget = useMemo(
    () => (isWidgetTool ? parsePortableNativeWidgetResult(props.result) : null),
    [isWidgetTool, props.result],
  )
  // A code widget only ever arrives whole: `widget_code` is kept intact by
  // `shouldKeepRemoteToolInput`, and the settled result is exempt from the 200-char
  // tool-result truncation. So the phone parses the same result the desktop does —
  // there is no partial-input path to mirror, and nothing to render until it lands.
  const codeWidget = useMemo(
    () => (isWidgetTool && !nativeWidget && props.result ? parseWidgetResult(props.result) : null),
    [isWidgetTool, nativeWidget, props.result],
  )
  const mcpIconSrc = useMcpToolIconSrc(props.toolName)
  const ports = useMemo<GenericToolRowPorts>(
    () => ({ ...PORTABLE_TOOL_ROW_PORTS, mcpIconSrc }),
    [mcpIconSrc],
  )
  if (props.toolName === 'mcp__superone__composer_request') {
    let title: string | undefined
    try { const parsed = JSON.parse(props.input); title = typeof parsed?.title === 'string' ? parsed.title : undefined } catch { /* projected or partial input */ }
    return <InputRequestToolRow title={title} result={props.result} streaming={props.status === 'streaming'} isError={props.isError} />
  }
  // Dispatch on the native type, never on "it parsed": the gallery draws images or videos and
  // would show a previewer payload as an empty video strip. An unknown native type keeps the
  // ordinary tool row, which is the only one that can still say what the call was.
  if (nativeWidget && props.status !== 'streaming' && !props.isError) {
    if (isGalleryPayload(nativeWidget)) return <PortableNativeGallery payload={nativeWidget} toolUseId={props.toolUseId} />
    if (nativeWidget.nativeType === 'files-previewer') return <PortableFilesPreviewer payload={nativeWidget} toolUseId={props.toolUseId} />
  }
  // Denied and failed calls keep the ordinary row: it is the only one that says why.
  if (codeWidget && props.status !== 'streaming' && !props.isError) {
    return <PortableWidgetBlock data={codeWidget} />
  }
  if (isWidgetTool && props.status === 'streaming') return <PortableWidgetGenerating />
  // A projection that lost the appId cannot name the call, so it falls through to the
  // shared row rather than rendering a card with no identity.
  if (props.toolName === 'mcp__superone__miniapp_call' && miniApp) {
    return (
      <PortableMiniAppTool
        identity={miniApp}
        result={props.result}
        status={props.status}
        allowExpand={allowExpand}
      />
    )
  }

  if (props.toolName === 'Bash') {
    return (
      <PortableBashTool
        toolUseId={props.toolUseId}
        input={props.input}
        toolSummary={props.toolSummary}
        result={props.result}
        status={props.status}
        isError={props.isError}
        bashEditDiff={props.bashEditDiff}
        allowExpand={allowExpand}
        onExpandedChange={props.onExpandedChange}
        detailStatus={props.detailStatus}
        onDetailRetry={props.onDetailRetry}
      />
    )
  }
  return (
    <GenericToolRowPresenter
      {...props}
      allowExpand={allowExpand}
      autoExpandFileDiffs={false}
      ports={ports}
    />
  )
}

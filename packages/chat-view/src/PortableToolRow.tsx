import { useContext, useMemo } from 'react'
import { cn } from '@superone/ui/lib/utils'
import { requestNative } from './bridge'
import { PortableMarkdown } from './PortableMarkdown'
import { PortableNativeGallery } from './PortableNativeGallery'
import { parsePortableNativeWidgetResult } from './portable-native-widget'
import { PortableTurnContext } from './portable-turn-context'
import {
  GenericToolRowPresenter,
  type FileDiffPresenterProps,
  type GenericToolRowPorts,
  type GenericToolRowProps,
} from './presenters/GenericToolRow'
import { AppToolBlockPresenter } from './presenters/AppToolBlock'
import { AnsiText } from './presenters/ansi'
import { ToolIcon } from './presenters/ToolIcon'
import { BashTerminalPresenter } from './presenters/BashTerminalPresenter'
import { parseNativeDiff } from './presenters/remote-diff'
import { tryPrettifyJson } from './presenters/tool-block-utils'
import type { QuestionPreviewFormat } from '@superone/shared/agent-types'

/** File name chip that hands the path to the native host instead of opening a desktop tab. */
function PortableFileChip({ name, title, filePath, className }: { name: string; title: string; filePath: string; className?: string }) {
  return (
    <button
      type="button"
      className={cn('min-w-0 shrink truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-primary', className)}
      title={title}
      onClick={(e) => { e.stopPropagation(); requestNative('openFile', { path: filePath }) }}
    >
      {name}
    </button>
  )
}

/**
 * Edited-file view for the phone. The WebView never receives `old_string`/`new_string`,
 * so it draws the diff the desktop precomputed — tokens included — rather than re-diffing.
 */
function PortableFileDiff({ toolDiff, toolDiffTokens }: Pick<FileDiffPresenterProps, 'toolDiff' | 'toolDiffTokens'>) {
  const lines = useMemo(() => (toolDiff ? parseNativeDiff(toolDiff, toolDiffTokens) : []), [toolDiff, toolDiffTokens])
  if (lines.length === 0) return null
  return (
    <div className="overflow-x-auto rounded bg-background/70 py-1 font-mono text-xs leading-relaxed">
      {lines.map((line, index) => (
        <div
          key={index}
          className={cn(
            'flex gap-2 px-2 whitespace-pre',
            line.kind === 'added' && 'bg-success/10 text-success',
            line.kind === 'removed' && 'bg-error/10 text-error',
            line.kind === 'context' && 'text-muted-foreground',
          )}
        >
          <span className="shrink-0 select-none text-muted-foreground/50">{line.line}</span>
          <span className="min-w-0">
            {line.tokens
              ? line.tokens.map(([text, color], i) => <span key={i} style={color ? { color } : undefined}>{text}</span>)
              : line.text}
          </span>
        </div>
      ))}
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
 * `bash_result` carries the command echo and the truncated tail, which is exactly what
 * the presenter falls back to when there is no streaming snapshot.
 */
function PortableBashTool({
  toolUseId,
  input,
  toolSummary,
  result,
  status,
  isError,
  allowExpand,
}: {
  toolUseId?: string
  input: string
  toolSummary?: string
  result?: string
  status?: 'streaming' | 'complete'
  isError?: boolean
  allowExpand: boolean
}) {
  const { pendingPermission } = useContext(PortableTurnContext)
  const params = useMemo(() => {
    try {
      const parsed = JSON.parse(input) as Record<string, unknown>
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
    } catch { return {} as Record<string, unknown> }
  }, [input])
  const isDenied = Boolean(result?.startsWith('[denied] '))
  const command = typeof params.command === 'string' ? params.command : (toolSummary ?? '')
  return (
    <BashTerminalPresenter
      toolUseId={toolUseId ?? ''}
      command={command}
      description={typeof params.description === 'string' ? params.description : undefined}
      fallbackResult={isDenied ? undefined : result}
      isStreaming={status === 'streaming'}
      isDenied={isDenied}
      isError={isError}
      timeoutMs={typeof params.timeout === 'number' ? params.timeout : undefined}
      runInBackground={params.run_in_background === true || params.background === true}
      allowExpand={allowExpand}
      isPendingPermission={Boolean(
        pendingPermission
        && (pendingPermission.toolUseId
          ? pendingPermission.toolUseId === toolUseId
          : pendingPermission.toolName === 'Bash'),
      )}
      readOutputFile={noRemoteOutputFile}
      readOutputMore={noRemoteOutputFile}
      renderAnsiText={(text) => <AnsiText text={text} />}
    />
  )
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

function PortableQuestionPreview({ content, format }: { content: string; format: QuestionPreviewFormat }) {
  const { scheme } = useContext(PortableTurnContext)
  if (format === 'html') {
    return <pre className="overflow-auto whitespace-pre-wrap break-all text-muted-foreground">{content}</pre>
  }
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

export function PortableToolRow({ allowExpand = true, ...props }: PortableToolRowProps) {
  // The desktop mounts `WidgetBlock` for a settled widget call; the phone renders the
  // same payload natively, so the short-circuit lives here rather than in the shared row.
  const miniApp = useMemo(
    () => (props.toolName === 'mcp__superone__miniapp_call' ? parseMiniAppIdentity(props.input) : null),
    [props.toolName, props.input],
  )
  const nativeWidget = useMemo(
    () => (props.toolName === 'mcp__superone__widget_show'
      ? parsePortableNativeWidgetResult(props.result)
      : null),
    [props.toolName, props.result],
  )
  if (nativeWidget && props.status !== 'streaming' && !props.isError) {
    return <PortableNativeGallery payload={nativeWidget} toolUseId={props.toolUseId} />
  }
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
        allowExpand={allowExpand}
      />
    )
  }
  return (
    <GenericToolRowPresenter
      {...props}
      allowExpand={allowExpand}
      autoExpandFileDiffs={false}
      ports={PORTABLE_TOOL_ROW_PORTS}
    />
  )
}

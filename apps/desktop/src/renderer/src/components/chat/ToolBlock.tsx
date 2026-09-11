import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@superone/ui/lib/utils'
import {
  buildUnifiedFileChangeDiffLines,
  DiffView,
  inferLanguage,
  splitContentLines,
  useHighlightedTokens,
  useIncrementalHighlightedLines,
  type DiffLine,
} from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { AnsiText } from '@/lib/ansi'
import { useStallLevel } from '@/lib/stall-utils'
import { resolveMiniAppToolIdentity } from '@/lib/miniapp-tool-identity'
import { useAppStore } from '@/stores/app'
import { useChatStore, useActiveSession, useBashOutput } from '@/stores/chat'
import { useMiniAppStore } from '@/stores/miniapp'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { CanvasEditDiff } from './CanvasEditDiff'
import { FileChip } from './FileChip'
import { useNestedToolDefaults } from './nested-tool-context'
import { StandaloneToolBlock } from './StandaloneToolBlock'
import { ToolIcon } from './ToolIcon'
import { ExitPlanModeBlockPresenter } from './presenters/PlanModeBlocks'
import {
  ToolBlockPresenter,
  type BashToolPresenterProps,
  type MiniAppToolPresenterProps,
  type ToolBlockPresenterPorts,
  type ToolBlockProps,
  type ToolFamilyRenderResult,
} from './ToolBlockPresenter'
import { BashTerminalPresenter } from './tool-block-presenters/BashTerminalPresenter'
import { PrettyJSONCodeBlock, QuestionPreviewContent } from './tool-result-views'
import { AppToolBlockPresenter, AppToolHeader, type AppToolBlockPresenterProps } from '@superone/chat-view/presenters/AppToolBlock'
import { ArtifactLinkChip } from './ArtifactLinkChip'
import { RollingNumber } from './RollingNumber'
import {
  CompactToolRow,
  ToolName,
  ToolStatusBadge,
  ToolStatusIcon,
  ToolSummary,
  toolOutcomeLabel,
  toolRowSurfaceClass,
  withStreamingEllipsis,
  type ToolRowTone,
} from './tool-row'
import { ToolRendererFrame } from './ToolRendererFrame'
import { parseMcpToolName } from './tool-display'
import { useMcpServerIcon } from './use-mcp-server-icon'

function toolRowTone(isDenied?: boolean, isError?: boolean): ToolRowTone {
  if (isDenied) return 'denied'
  if (isError) return 'error'
  return 'default'
}

/** Desktop mini-app card: the shared header/result card with a highlighted JSON body. */
function AppToolBlock(props: Omit<AppToolBlockPresenterProps, 'renderJson'>) {
  return <AppToolBlockPresenter {...props} renderJson={(text) => <PrettyJSONCodeBlock text={text} />} />
}

function AppResultRendererBlock({ appId, toolUseId, toolName, appName, toolReadableName, summary, icon, templatePath, result, autoExpand }: {
  appId: string
  toolUseId: string
  toolName: string
  appName?: string
  toolReadableName: string
  summary: string
  icon: React.ReactNode
  templatePath: string
  result: unknown
  autoExpand: boolean
}) {
  const [expanded, setExpanded] = useState(autoExpand)
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {icon}
        <AppToolHeader appName={appName} toolText={toolReadableName} isStreaming={false} summary={summary} />
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-1.5">
            {expanded && (
              <ToolRendererFrame
                phase="result"
                appId={appId}
                callId={toolUseId}
                toolName={toolName}
                templatePath={templatePath}
                result={result}
                onClose={() => setExpanded(false)}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

type DesktopMiniApp = ReturnType<typeof useMiniAppStore.getState>['apps'][number]
type DesktopToolRendererState = ReturnType<typeof useChatStore.getState>['toolRenderers'][string]

interface DesktopMiniAppRenderDeps {
  apps: DesktopMiniApp[]
  interceptState?: DesktopToolRendererState
  showInFolder: (directory: string, filename: string) => void
  t: (key: string) => string
}

function renderDesktopMiniAppTool(
  props: MiniAppToolPresenterProps,
  deps: DesktopMiniAppRenderDeps,
): ToolFamilyRenderResult {
  const { mcpToolName, params, result, isStreaming, isDenied, isError, allowExpand, grouped, toolUseId } = props

  if (mcpToolName === 'miniapp_dev_pack') {
    const appDir = String(params.appDir ?? '')
    const outputDir = String(params.outputDir ?? '')
    const packApp = appDir
      ? deps.apps.find((app) => app.distDir === appDir || app.installDir === appDir)
      : undefined
    const archiveName = packApp
      ? `${packApp.manifest.appId}-${packApp.manifest.version}.s1app`
      : null
    return {
      handled: true,
      node: (
        <CompactToolRow
          icon={<ToolIcon icon="package" className="size-3 shrink-0 text-muted-foreground" />}
          tone={toolRowTone(isDenied, isError)}
        >
          <ToolName streaming={isStreaming} tone={toolRowTone(isDenied, isError)}>
            {toolOutcomeLabel({
              streaming: isStreaming,
              interrupted: isDenied || isError,
              streamingLabel: deps.t('chat.toolBlock.packing'),
              actionLabel: deps.t('chat.toolBlock.packing'),
              doneLabel: deps.t('chat.toolBlock.miniAppPacked'),
            })}
          </ToolName>
          {isStreaming && packApp ? <MiniAppIcon appId={packApp.id} className="size-3.5 shrink-0" /> : null}
          {isStreaming ? (
            <ToolSummary>{packApp?.manifest.name ?? appDir.split('/').pop()}</ToolSummary>
          ) : archiveName ? (
            <button
              type="button"
              className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline"
              onClick={(event) => {
                event.stopPropagation()
                deps.showInFolder(outputDir, archiveName)
              }}
            >
              {archiveName}
            </button>
          ) : null}
          <ToolStatusBadge tone={toolRowTone(isDenied, isError)} />
        </CompactToolRow>
      ),
    }
  }

  // Mini-app iframe/renderers deliberately stay in the Desktop adapter during WP-16.
  const resolvedAppTool = resolveMiniAppToolIdentity(mcpToolName, params, deps.apps)
  if (!resolvedAppTool) return { handled: false, node: null }

  const canvasApp = deps.apps.find((app) => app.id === resolvedAppTool.appId)
  const toolDef = resolvedAppTool.toolDef
  const mcpToolNamePart = resolvedAppTool.toolName
  const appName = canvasApp?.manifest.name ?? resolvedAppTool.app.manifest.name
  const toolReadableName = toolDef?.displayName ?? mcpToolNamePart.replace(/_/g, ' ')
  const runningText = toolDef?.runningText ?? toolReadableName
  const appToolExpandable = allowExpand && !!(toolDef?.showResult && result && !isStreaming)
  const toolParams = resolvedAppTool.toolInput
  const inputSummary = toolDef?.inputSummaryField ? String(toolParams[toolDef.inputSummaryField] ?? '') : ''
  let resultSummary = ''
  if (!isStreaming && result && toolDef?.resultSummaryField) {
    try { resultSummary = String(JSON.parse(result)[toolDef.resultSummaryField] ?? '') } catch { /* raw result */ }
  }

  if (deps.interceptState) {
    return {
      handled: true,
      node: (
        <div className="tool-node my-0.5 rounded bg-muted/20 p-2">
          <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
            {canvasApp
              ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" />
              : <ToolIcon icon="plug" className="size-3 shrink-0" />}
            <span>{appName}</span>
            <span className="text-muted-foreground/70">·</span>
            <span>{toolReadableName}</span>
            <span className="text-muted-foreground/70">· needs your input</span>
          </div>
          <ToolRendererFrame phase="intercept" state={deps.interceptState} />
        </div>
      ),
    }
  }

  if (toolDef?.standalone && canvasApp) {
    const templateKey = toolDef.renderer?.result?.template
    const templatePath = templateKey ? canvasApp.manifest.templates?.[templateKey] : undefined
    if (templatePath) {
      return {
        handled: true,
        node: (
          <StandaloneToolBlock
            appId={canvasApp.id}
            toolUseId={toolUseId ?? ''}
            toolName={mcpToolNamePart}
            appName={appName}
            toolReadableName={toolReadableName}
            args={toolParams}
            result={result}
            isStreaming={isStreaming}
            templatePath={templatePath}
          />
        ),
      }
    }
  }

  const resultRenderer = toolDef?.renderer?.result
  const resultTemplatePath = resultRenderer && canvasApp?.manifest.templates
    ? canvasApp.manifest.templates[resultRenderer.template]
    : undefined
  if (!isStreaming && result && resultRenderer && resultTemplatePath && canvasApp) {
    let parsedResult: unknown
    try { parsedResult = JSON.parse(result) } catch { parsedResult = result }
    return {
      handled: true,
      node: (
        <AppResultRendererBlock
          appId={canvasApp.id}
          toolUseId={toolUseId ?? ''}
          toolName={mcpToolNamePart}
          appName={grouped ? undefined : appName}
          toolReadableName={toolReadableName}
          summary={resultSummary || inputSummary}
          icon={<MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" />}
          templatePath={resultTemplatePath}
          result={parsedResult}
          autoExpand={!!resultRenderer.autoExpand}
        />
      ),
    }
  }

  return {
    handled: true,
    node: (
      <AppToolBlock
        icon={canvasApp
          ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" />
          : <ToolIcon icon="plug" className="size-3 shrink-0 text-muted-foreground" />}
        appName={grouped ? undefined : appName}
        toolText={isStreaming ? runningText : toolReadableName}
        summary={isStreaming ? inputSummary : (resultSummary || inputSummary)}
        isStreaming={isStreaming}
        expandable={appToolExpandable}
        result={result}
      />
    ),
  }
}

export const ToolBlock = memo(function ToolBlock(props: ToolBlockProps) {
  const { t } = useTranslation()
  const nestedDefaults = useNestedToolDefaults()
  const autoExpandFileDiffs = useAppStore((state) => state.autoExpandFileDiffs)
  const cwd = useActiveSession((state) => state.cwd)
  const homedir = useActiveSession((state) => state.homedir)
  const streamingInputPreview = useActiveSession((state) => (
    props.toolUseId ? state._streamingToolInputPreviews[props.toolUseId] : undefined
  ))
  const switchSession = useChatStore((state) => state.switchSession)
  const toolInterceptState = useChatStore((state) => (
    props.toolUseId
      ? Object.values(state.toolRenderers).find((renderer) => (
        renderer.toolUseId === props.toolUseId && renderer.status === 'awaiting'
      ))
      : undefined
  ))
  const miniApps = useMiniAppStore((state) => state.apps)
  const isStreaming = props.status === 'streaming'
  const stallLevel = useStallLevel(isStreaming)
  const mcpInfo = useMemo(() => parseMcpToolName(props.toolName), [props.toolName])
  const mcpIconSrc = useMcpServerIcon(mcpInfo?.serverName)

  const ports = useMemo<ToolBlockPresenterPorts>(() => ({
    cwd,
    homedir,
    streamingInputPreview,
    mcpIconSrc,
    stallLevel,
    onOpenSession: switchSession,
    onWidgetInputComplete: ({ title, inputLength }) => {
      window.app.trace?.('widget.ui', 'input_complete_early', { title, inputLen: inputLength })
    },
    renderBash: (bashProps) => <BashTerminalView {...bashProps} />,
    renderFileChip: (fileProps) => <FileChip {...fileProps} />,
    renderFileDiff: ({ toolName, params, isStreaming: diffStreaming, useCanvasEdit }) => {
      if (toolName === 'Edit') {
        if (useCanvasEdit) return <CanvasEditDiff params={params} />
        return String(params.old_string ?? '') || String(params.new_string ?? '')
          ? <EditDiff params={params} />
          : <FileChangeDiff params={params} />
      }
      if (toolName === 'Write') return <WriteDiff params={params} isStreaming={diffStreaming} />
      return <FileChangeDiff params={params} isStreaming={diffStreaming} />
    },
    renderArtifactChip: ({ url, label }) => <ArtifactLinkChip url={url} label={label} />,
    renderCount: (value) => <RollingNumber value={value} />,
    renderJson: (text) => <PrettyJSONCodeBlock text={text} />,
    renderQuestionPreview: (preview) => <QuestionPreviewContent {...preview} />,
    renderExitPlanMode: (planResult) => <ExitPlanModeBlock result={planResult} />,
    renderMiniAppTool: (miniAppProps) => renderDesktopMiniAppTool(miniAppProps, {
      apps: miniApps,
      interceptState: toolInterceptState,
      showInFolder: (directory, filename) => window.app.showInFolder(directory, filename),
      t,
    }),
  }), [cwd, homedir, mcpIconSrc, miniApps, stallLevel, streamingInputPreview, switchSession, t, toolInterceptState])

  return (
    <ToolBlockPresenter
      {...props}
      allowExpand={nestedDefaults?.allowExpand !== false}
      defaultAutoExpand={nestedDefaults?.defaultAutoExpand}
      autoExpandFileDiffs={autoExpandFileDiffs}
      ports={ports}
    />
  )
})

export { FileChip }
export { DebugToolBlock, ToolBlockPresenter } from './ToolBlockPresenter'

function readBashOutputFile(path: string, lines: number): Promise<string> {
  return window.app.readBashOutputFile(path, lines)
}

function readBashOutputMore(toolUseId: string, lines: number): Promise<string> {
  return window.app.readBashOutputMore(toolUseId, lines)
}

function renderBashAnsiText(text: string): ReactNode {
  return <AnsiText text={text} />
}

function BashTerminalView(props: BashToolPresenterProps) {
  const bashOutput = useBashOutput(props.toolUseId)
  const taskProgress = useActiveSession((state) => state.taskProgress[props.toolUseId])
  const isPendingPermission = useActiveSession((state) => (
    state.pendingPermissions.some((permission) => permission.toolUseId === props.toolUseId)
  ))

  return (
    <BashTerminalPresenter
      {...props}
      bashOutput={bashOutput}
      taskProgress={taskProgress}
      isPendingPermission={isPendingPermission}
      readOutputFile={readBashOutputFile}
      readOutputMore={readBashOutputMore}
      renderAnsiText={renderBashAnsiText}
    />
  )
}

function buildDiffLines(oldStr: string, newStr: string, startLine: number): DiffLine[] {
  const changes = diffLines(oldStr, newStr)
  const result: DiffLine[] = []
  let oldLine = startLine
  let newLine = startLine
  let oldIdx = 0
  let newIdx = 0

  for (const change of changes) {
    const lines = change.value.replace(/\n$/, '').split('\n')
    if (change.removed) {
      for (const text of lines) {
        result.push({ kind: 'removed', lineNum: oldLine++, text, sourceIdx: oldIdx++ })
      }
    } else if (change.added) {
      for (const text of lines) {
        result.push({ kind: 'added', lineNum: newLine++, text, sourceIdx: newIdx++ })
      }
    } else {
      for (const text of lines) {
        result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
        oldLine++; newLine++; oldIdx++; newIdx++
      }
    }
  }
  return result
}


function buildFileChangeDiffLines(kind: string, diffText: string): DiffLine[] {
  const rows = splitContentLines(diffText)
  if (rows.length === 0) return []

  if (kind === 'add') {
    return rows.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }
  if (kind === 'delete') {
    return rows.map((text, i) => ({ kind: 'removed' as const, lineNum: i + 1, text, sourceIdx: i }))
  }

  const unified = buildUnifiedFileChangeDiffLines(diffText)
  if (unified.length > 0) return unified

  const result: DiffLine[] = []
  let oldLine = 1
  let newLine = 1
  let oldIdx = 0
  let newIdx = 0

  for (const row of rows) {
    if (row.startsWith('+') && !row.startsWith('+++')) {
      result.push({ kind: 'added', lineNum: newLine++, text: row.slice(1), sourceIdx: newIdx++ })
      continue
    }
    if (row.startsWith('-') && !row.startsWith('---')) {
      result.push({ kind: 'removed', lineNum: oldLine++, text: row.slice(1), sourceIdx: oldIdx++ })
      continue
    }
    const text = row.startsWith(' ') ? row.slice(1) : row
    result.push({ kind: 'unchanged', lineNum: newLine, text, sourceIdx: newIdx })
    oldLine++
    newLine++
    oldIdx++
    newIdx++
  }

  return result
}

function buildDiffSourceLines(lines: DiffLine[]): { oldLines: string[]; newLines: string[] } {
  const oldLines: string[] = []
  const newLines: string[] = []

  for (const line of lines) {
    if (line.kind !== 'added') oldLines.push(line.text)
    if (line.kind !== 'removed') newLines.push(line.text)
  }

  return {
    oldLines,
    newLines,
  }
}


const TOOL_DIFF_CLASS = 'bg-transparent'

/** Unified diff for Edit tool with actual file line numbers. */
export function EditDiff({ params }: { params: Record<string, unknown> }) {
  const oldStr = String(params.old_string ?? '')
  const newStr = String(params.new_string ?? '')
  const filePath = String(params.file_path ?? '')
  const activeProject = useChatStore((s) => s.activeProject)
  const [startLine, setStartLine] = useState(1)
  const language = inferLanguage(filePath)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])

  const oldTokens = useHighlightedTokens(oldStr, language, { cache })
  const newTokens = useHighlightedTokens(newStr, language, { cache })

  useEffect(() => {
    if (!filePath || !activeProject) return
    let cancelled = false
    const tryFind = async (): Promise<void> => {
      if (newStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, newStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
      if (oldStr) {
        const line = await window.agent.findLineNumber(activeProject, filePath, oldStr)
        if (!cancelled && line != null) { setStartLine(line); return }
      }
    }
    tryFind()
    return () => { cancelled = true }
  }, [filePath, oldStr, newStr, activeProject])

  const lines = useMemo<DiffLine[]>(
    () => buildDiffLines(oldStr, newStr, startLine),
    [oldStr, newStr, startLine],
  )

  if (!oldStr && !newStr) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} className={TOOL_DIFF_CLASS} />
}

/** Content preview for Write tool (all lines are additions). */
export function WriteDiff({ params, isStreaming }: { params: Record<string, unknown>; isStreaming?: boolean }) {
  return isStreaming
    ? <WriteDiffStreaming params={params} />
    : <WriteDiffStatic params={params} />
}

function WriteDiffStreaming({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])
  const committedLines = useMemo(() => {
    if (!content) return []
    const idx = content.lastIndexOf('\n')
    if (idx === -1) return []
    return content.slice(0, idx).split('\n')
  }, [content])
  const tokens = useIncrementalHighlightedLines(committedLines, language)
  const lines = useMemo<DiffLine[]>(() => {
    if (contentLines.length === 0) return []
    return contentLines.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [contentLines])
  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} autoScrollBottom className={TOOL_DIFF_CLASS} />
}

function WriteDiffStatic({ params }: { params: Record<string, unknown> }) {
  const content = String(params.content ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const activeProject = useChatStore((s) => s.activeProject)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])
  const contentLines = useMemo(() => content ? content.split('\n') : [], [content])
  const tokens = useHighlightedTokens(content, language, { cache })
  const lines = useMemo<DiffLine[]>(() => {
    if (contentLines.length === 0) return []
    return contentLines.map((text, i) => ({ kind: 'added' as const, lineNum: i + 1, text, sourceIdx: i }))
  }, [contentLines])
  if (lines.length === 0) return null
  return <DiffView lines={lines} newTokens={tokens} className={TOOL_DIFF_CLASS} />
}

function FileChangeDiff({ params, isStreaming }: { params: Record<string, unknown>; isStreaming?: boolean }) {
  return isStreaming
    ? <FileChangeDiffStreaming params={params} />
    : <FileChangeDiffStatic params={params} />
}

function FileChangeDiffStreaming({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldLines, newLines } = useMemo(() => buildDiffSourceLines(lines), [lines])
  const hasPartialTail = diff.length > 0 && !diff.endsWith('\n')
  const committedOldLines = useMemo(
    () => (hasPartialTail && oldLines.length > 0 ? oldLines.slice(0, -1) : oldLines),
    [oldLines, hasPartialTail],
  )
  const committedNewLines = useMemo(
    () => (hasPartialTail && newLines.length > 0 ? newLines.slice(0, -1) : newLines),
    [newLines, hasPartialTail],
  )
  const oldTokens = useIncrementalHighlightedLines(committedOldLines, language)
  const newTokens = useIncrementalHighlightedLines(committedNewLines, language)
  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} autoScrollBottom className={TOOL_DIFF_CLASS} />
}

function FileChangeDiffStatic({ params }: { params: Record<string, unknown> }) {
  const diff = String(params.diff ?? '')
  const kind = String(params.kind ?? '')
  const filePath = String(params.file_path ?? '')
  const language = inferLanguage(filePath)
  const activeProject = useChatStore((s) => s.activeProject)
  const cache = useMemo(() => getHighlightCache(activeProject), [activeProject])
  const lines = useMemo(() => buildFileChangeDiffLines(kind, diff), [kind, diff])
  const { oldLines, newLines } = useMemo(() => buildDiffSourceLines(lines), [lines])
  const oldTokens = useHighlightedTokens(oldLines.join('\n'), language, { cache })
  const newTokens = useHighlightedTokens(newLines.join('\n'), language, { cache })
  if (!diff || lines.length === 0) return null
  return <DiffView lines={lines} oldTokens={oldTokens} newTokens={newTokens} className={TOOL_DIFF_CLASS} />
}

/** ExitPlanMode: shows pending / approved / rejected state.
 *  Derives outcome from tool result (persisted in messages) with live store as fallback. */
function ExitPlanModeBlock({ result }: { result?: string }) {
  const liveOutcome = useActiveSession((s) => s.planApprovalOutcome)
  return <ExitPlanModeBlockPresenter result={result} liveOutcome={liveOutcome} />
}

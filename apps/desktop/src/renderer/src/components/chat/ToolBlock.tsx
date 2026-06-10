import { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback, memo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, PenLine, Check, X, Ban, TriangleAlert, Upload, Smartphone } from 'lucide-react'
import { diffLines } from 'diff'
import { cn } from '@superone/ui/lib/utils'
import { inferLanguage, useHighlightedTokens, useIncrementalHighlightedLines, type DiffLine, DiffView, splitContentLines, buildUnifiedFileChangeDiffLines } from '@/lib/diff-utils'
import { getHighlightCache } from '@/lib/highlight-cache'
import { useChatStore, useActiveSession, useBashOutput, useShareProgress } from '@/stores/chat'
import { openFileTab } from '@/components/activity/activity-panel-api'
import { useSettingsStore } from '@/stores/settings'
import { useSourceControlStore } from '@/stores/source-control'
import { ToolIcon } from './ToolIcon'
import { DraggableFileIcon } from './DraggableFileIcon'
import { HighlightedCodeBlock } from './CodeBlock'
import { getToolDisplay, getToolVerb, parseToolInput, parseMcpToolName, formatReadMeta, type ToolIcon as ToolIconType } from './tool-display'
import { codePlugin } from './chat-shared'
import { useStallLevel, getStallColor } from '@/lib/stall-utils'
import { AnsiText } from '@/lib/ansi'
import { countUnifiedDiffDelta, countPrefixedDiffDelta, computeLineDelta, computeStreamingEditDelta, tryPrettifyJson, parseQAPairs, extractToolError } from './tool-block-utils'
import { WidgetBlock } from './WidgetBlock'
import { useNestedToolDefaults } from './nested-tool-context'
import { CanvasEditDiff } from './CanvasEditDiff'
import { RollingNumber } from './RollingNumber'
import { parseWidgetResult, parsePartialWidgetInput } from '@superone/shared/generative-ui/types'
import { ToolRendererFrame } from './ToolRendererFrame'
import { StandaloneToolBlock } from './StandaloneToolBlock'
import { MiniAppIcon } from '@/components/miniapp/MiniAppIcon'
import { useMiniAppStore } from '@/stores/miniapp'
import { clickReleasedOnSelection, parseFileLinkTarget } from '@/lib/file-link'

function isCompleteJson(s: string): boolean {
  try { JSON.parse(s); return true } catch { return false }
}

const SUPERONE_SERVER = 'superone'

function CompactToolRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="tool-node my-0.5 rounded bg-muted/20">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        {icon}
        {children}
      </div>
    </div>
  )
}

function AppToolHeader({ appName, toolText, isStreaming, summary }: { appName?: string; toolText: string; isStreaming: boolean; summary: string }) {
  return (
    <>
      {appName && <><span className="shrink-0 font-medium text-foreground">{appName}</span><span className="shrink-0 text-muted-foreground">·</span></>}
      <span className="shrink-0 text-foreground">{isStreaming ? <>{toolText}…</> : toolText}</span>
      {summary && <span className="min-w-0 truncate text-muted-foreground">{summary}</span>}
    </>
  )
}

function AppToolBlock({ icon, appName, toolText, summary, isStreaming, expandable, result }: {
  icon: React.ReactNode
  appName?: string
  toolText: string
  summary: string
  isStreaming: boolean
  expandable: boolean
  result?: string
}) {
  const [expanded, setExpanded] = useState(false)
  if (!expandable) {
    return (
      <CompactToolRow icon={icon}>
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
      </CompactToolRow>
    )
  }
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {icon}
        <AppToolHeader appName={appName} toolText={toolText} isStreaming={isStreaming} summary={summary} />
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="px-2 pb-1.5">
            <PrettyJSONCodeBlock text={result!} />
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupMiniAppDevBlock({ appName, isStreaming, params, result }: {
  appName: string
  isStreaming: boolean
  params: Record<string, unknown>
  result: Record<string, unknown> | null
}) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const errored = !!result && result.status === 'error'
  const headerLabel = errored
    ? t('chat.toolBlock.setUpMiniAppFailed')
    : isStreaming
      ? t('chat.toolBlock.settingUpMiniApp')
      : t('chat.toolBlock.setUpMiniApp')
  const appId = result?.appId ? String(result.appId) : ''
  const directory = params.directory ? String(params.directory) : ''
  const description = params.description ? String(params.description) : ''
  const errorMsg = errored ? String((result?.message as string | undefined) ?? '') : ''
  const rows: Array<{ key: string; label: string; value: string; mono?: boolean }> = []
  if (appId) rows.push({ key: 'appId', label: t('chat.toolBlock.setupFields.appId'), value: appId, mono: true })
  if (directory) rows.push({ key: 'directory', label: t('chat.toolBlock.setupFields.directory'), value: directory, mono: true })
  if (description) rows.push({ key: 'description', label: t('chat.toolBlock.setupFields.description'), value: description })
  return (
    <div className={cn('tool-node my-0.5 rounded bg-muted/20', 'cursor-pointer hover:bg-muted/40')}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        <ToolIcon icon="file-plus" className={cn('size-3 shrink-0', errored ? 'text-destructive' : 'text-muted-foreground')} />
        <span className="shrink-0 font-medium text-foreground">{headerLabel}{isStreaming && '…'}</span>
        {appName && <>
          <span className="shrink-0 text-muted-foreground">·</span>
          <span className="min-w-0 truncate text-foreground">{appName}</span>
        </>}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="space-y-1 border-t border-border/40 px-2 py-2 text-xs">
            {errorMsg && (
              <div className="mb-2 rounded bg-destructive/10 px-2 py-1.5 text-destructive">
                {errorMsg}
              </div>
            )}
            {rows.map(({ key, label, value, mono }) => (
              <div key={key} className="flex items-baseline gap-2">
                <span className="w-24 shrink-0 text-muted-foreground">{label}</span>
                <span className={cn('min-w-0 flex-1 break-all text-foreground', mono && 'font-mono')}>{value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
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

/** Dev-only: comma-separated tool names to show raw debug UI. e.g. RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate */
const DEBUG_TOOL_NAMES: string[] = import.meta.env.DEV
  ? (import.meta.env.RENDERER_VITE_DEBUG_TOOL_NAMES ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean)
  : []

interface ToolBlockProps {
  toolName: string
  toolUseId?: string
  input: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
  result?: string
  isTimedOut?: boolean
  isError?: boolean
  resultOutputPath?: string
  autoExpand?: boolean
  backgroundActivity?: boolean
  grouped?: boolean
}

const DIFF_TOOLS = new Set(['Edit', 'Write', 'FileChange'])
const FILE_PATH_TOOLS = new Set(['Read', 'Edit', 'Write', 'NotebookEdit', 'FileChange'])



export const ToolBlock = memo(function ToolBlock({ toolName, toolUseId, input, status, elapsedSeconds, result, isTimedOut, isError, resultOutputPath, autoExpand, backgroundActivity = false, grouped = false }: ToolBlockProps) {
  const { t } = useTranslation()
  const nestedDefaults = useNestedToolDefaults()
  const effectiveAutoExpand = autoExpand ?? nestedDefaults?.defaultAutoExpand ?? true
  const cwd = useActiveSession((s) => s.cwd)
  const homedir = useActiveSession((s) => s.homedir)
  const streamingInputPreview = useActiveSession((s) => toolUseId ? s._streamingToolInputPreviews[toolUseId] : undefined)
  const toolInterceptState = useChatStore((s) =>
    toolUseId ? Object.values(s.toolRenderers).find((r) => r.toolUseId === toolUseId && r.status === 'awaiting') : undefined,
  )
  const parsedParams = useMemo(() => parseToolInput(input, toolName), [input, toolName])
  const isStreaming = status === 'streaming'
  const params = isStreaming && streamingInputPreview ? streamingInputPreview : parsedParams
  const display = useMemo(() => getToolDisplay(toolName, params, cwd, homedir), [toolName, params, cwd, homedir])
  const mcpInfo = parseMcpToolName(toolName)
  const isMcp = mcpInfo !== null
  const mcpMeta = useSettingsStore((s) => s.mcpMeta)
  const mcpLibrary = useSettingsStore((s) => s.mcpLibrary)
  const mcpIconSrc = isMcp
    ? (mcpMeta[mcpInfo.serverName]?.icons?.[0]?.src
      ?? mcpLibrary.find((e) => e.name === mcpInfo.serverName)?.icons?.[0]?.src)
    : undefined
  const stallLevel = useStallLevel(isStreaming)
  const fileToolPath = FILE_PATH_TOOLS.has(toolName) ? String(params.file_path ?? params.notebook_path ?? '') : ''
  const fileToolName = fileToolPath ? fileToolPath.split('/').pop() || '' : ''
  const miniApps = useMiniAppStore((s) => s.apps)

  const isDenied = !!result && result.startsWith('[denied] ')
  const cleanResult = isDenied ? result.slice('[denied] '.length) : result
  const deniedFeedback = isDenied && cleanResult !== 'User denied permission' ? cleanResult! : ''
  const feedbackRef = useRef<HTMLSpanElement>(null)
  const [feedbackIsBlock, setFeedbackIsBlock] = useState(false)

  useLayoutEffect(() => {
    if (!deniedFeedback) { setFeedbackIsBlock(false); return }
    const el = feedbackRef.current
    if (!el) return
    setFeedbackIsBlock(el.scrollWidth > el.clientWidth)
  }, [deniedFeedback])

  const lineDelta = useMemo(() => {
    if (isDenied || isError) return null
    if (isStreaming && toolName === 'Edit') {
      if (!('new_string' in params)) return null
      return computeStreamingEditDelta(String(params.old_string ?? ''), String(params.new_string ?? ''))
    }
    return computeLineDelta(toolName, params)
  }, [toolName, params, isDenied, isError, isStreaming])
  const hasStreamingDiffContent = DIFF_TOOLS.has(toolName) && isStreaming && (
    toolName === 'Edit'
      ? String(params.new_string ?? '').length > 0 || String(params.old_string ?? '').length > 0
      : toolName === 'Write'
        ? String(params.content ?? '').length > 0
        : String(params.diff ?? '').length > 0
  )
  const hasCompleteDiff = DIFF_TOOLS.has(toolName) && !isStreaming && !isDenied && !isError && (
    toolName === 'FileChange'
      ? String(params.diff ?? '').length > 0
      : Object.keys(params).length > 0
  )
  const hasDiff = hasCompleteDiff || hasStreamingDiffContent
  const [expanded, setExpanded] = useState(false)
  const gridRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (DIFF_TOOLS.has(toolName) && hasDiff && effectiveAutoExpand) {
      setExpanded(true)
      const grid = gridRef.current
      if (grid && !isStreaming) {
        grid.style.transition = 'none'
        requestAnimationFrame(() => { grid.style.transition = '' })
      }
    }
  }, [isStreaming, hasDiff, toolName, effectiveAutoExpand])

  useLayoutEffect(() => {
    if (isError) setExpanded(false)
  }, [isError])

  // Debug mode (dev only): highest priority — show raw input/output for matching tools
  // Set RENDERER_VITE_DEBUG_TOOL_NAMES=TodoWrite,TaskCreate to enable
  const isDebug = DEBUG_TOOL_NAMES.length > 0 &&
    DEBUG_TOOL_NAMES.some((n) => toolName.toLowerCase().includes(n))
  if (isDebug) {
    return <DebugToolBlock toolName={toolName} input={input} result={result} status={status} elapsedSeconds={elapsedSeconds} />
  }

  if (toolName === 'TodoWrite' || toolName === 'TaskCreate' || toolName === 'TaskUpdate') return null

  const isQuestionDismissed = toolName === 'AskUserQuestion' && !!result && (isDenied || result.includes('dismissed'))

  if (toolName === 'Bash') {
    const timeout = typeof params.timeout === 'number' ? params.timeout : undefined
    const runInBackground = params.run_in_background === true || params.background === true
    const description = typeof params.description === 'string' ? params.description : undefined
    return (
      <BashTerminalView
        toolUseId={toolUseId ?? ''}
        command={display.summary}
        description={description}
        fallbackResult={isDenied ? undefined : (result ?? undefined)}
        isStreaming={isStreaming}
        isDenied={isDenied}
        isError={isError}
        timeoutMs={timeout}
        isTimedOut={isTimedOut}
        resultOutputPath={resultOutputPath}
        runInBackground={runInBackground}
        autoExpand={effectiveAutoExpand}
        backgroundActivity={backgroundActivity}
      />
    )
  }

  if (toolName === 'EnterPlanMode') {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-primary/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-primary" />
        <span className="font-medium text-primary">{t('chat.toolBlock.enteredPlanMode')}</span>
      </div>
    )
  }
  if (toolName === 'ExitPlanMode') {
    return <ExitPlanModeBlock result={result} />
  }
  const hasResult = !!cleanResult && !isStreaming && !isDenied && toolName !== 'Read' && toolName !== 'Skill' && toolName !== 'AskUserQuestion'
  const hasQA = toolName === 'AskUserQuestion' && !!cleanResult && !isStreaming && !isQuestionDismissed
  const expandable = hasDiff || hasResult || hasQA

  // For unknown tools, show truncated raw input as fallback
  const summary = display.summary || (!isMcp && display.icon === 'wrench' && input.length > 0
    ? (input.length > 80 ? input.slice(0, 80) + '\u2026' : input)
    : '')

  const displayName = mcpInfo
    ? <>{mcpInfo.serverName}<span className="text-muted-foreground"> · </span>{mcpInfo.mcpToolName}</>
    : toolName

  if (mcpInfo?.mcpToolName === 'widget_read_guide') {
    const modules = Array.isArray(params.modules) ? (params.modules as string[]).join(', ') : ''
    return (
      <CompactToolRow icon={<ToolIcon icon="book-open" className="size-3 shrink-0 text-muted-foreground" />}>
        <span className="font-medium text-foreground">
          {isStreaming ? <>{t('chat.toolBlock.readingWidgetGuidelines')}</> : t('chat.toolBlock.readWidgetGuidelines')}
          {modules && <>: <span className="text-muted-foreground">{modules}</span></>}
        </span>
      </CompactToolRow>
    )
  }

  if (mcpInfo?.serverName === SUPERONE_SERVER) {
    const superoneToolDisplay: Record<string, { icon: ToolIconType; streaming: string; done: string; summaryField?: string }> = {
      miniapp_dev_read_guide: { icon: 'book-open', streaming: t('chat.toolBlock.readingMiniAppGuide'), done: t('chat.toolBlock.readMiniAppGuide'), summaryField: 'topic' },
      session_rename: { icon: 'pencil', streaming: t('chat.toolBlock.renamingSession'), done: t('chat.toolBlock.renamedSession'), summaryField: 'title' },
    }
    if (mcpInfo.mcpToolName === 'miniapp_dev_pack') {
      const appDir = String(params.appDir ?? '')
      const outputDir = String(params.outputDir ?? '')
      const packApp = appDir ? miniApps.find((a) => a.distDir === appDir || a.installDir === appDir) : undefined
      const s1appName = packApp ? `${packApp.manifest.appId}-${packApp.manifest.version}.s1app` : null
      return (
        <CompactToolRow icon={<ToolIcon icon="package" className="size-3 shrink-0 text-muted-foreground" />}>
          {isStreaming ? (
            <>
              <span className="font-medium text-foreground">{t('chat.toolBlock.packing')}</span>
              {packApp && <MiniAppIcon appId={packApp.id} className="size-3.5 shrink-0" />}
              <span className="text-muted-foreground">{packApp?.manifest.name ?? appDir.split('/').pop()}</span>
            </>
          ) : (
            <>
              <span className="font-medium text-foreground">{t('chat.toolBlock.miniAppPacked')}</span>
              {s1appName && <>
                <span className="text-muted-foreground">:</span>
                <button className="min-w-0 truncate text-muted-foreground hover:text-foreground hover:underline" onClick={(e) => { e.stopPropagation(); window.app.showInFolder(outputDir, s1appName) }}>{s1appName}</button>
              </>}
            </>
          )}
        </CompactToolRow>
      )
    }
    if (mcpInfo.mcpToolName === 'mobile_share_file') {
      return <MobileShareFileBlock params={params} result={!isStreaming ? (result ?? null) : null} isStreaming={isStreaming} />
    }
    if (mcpInfo.mcpToolName === 'miniapp_dev_setup') {
      const appName = String(params.name ?? '')
      let parsedResult: Record<string, unknown> | null = null
      if (!isStreaming && result) {
        try { parsedResult = JSON.parse(result) as Record<string, unknown> } catch {}
      }
      return (
        <SetupMiniAppDevBlock
          appName={appName}
          isStreaming={isStreaming}
          params={params}
          result={parsedResult}
        />
      )
    }
    const d = superoneToolDisplay[mcpInfo.mcpToolName]
    if (d) {
      const summaryValue = d.summaryField ? String(params[d.summaryField] ?? '') : ''
      return (
        <CompactToolRow icon={<ToolIcon icon={d.icon} className="size-3 shrink-0 text-muted-foreground" />}>
          <span className="font-medium text-foreground">{isStreaming ? <>{d.streaming}…</> : d.done}{summaryValue && <>: <span className="text-muted-foreground">{summaryValue}</span></>}</span>
        </CompactToolRow>
      )
    }
    const appToolMatch = mcpInfo.mcpToolName.match(/^(.+?)__(.+)$/)
    if (appToolMatch) {
      const [, mcpSlug, mcpToolNamePart] = appToolMatch
      const canvasApp = miniApps.find((a) => (a.manifest.toolSlug ?? a.id) === mcpSlug)
      const toolDef = canvasApp?.manifest.tools?.find((t) => t.name === mcpToolNamePart)
      const appName = canvasApp?.manifest.name ?? mcpSlug
      const toolReadableName = toolDef?.displayName ?? mcpToolNamePart.replace(/_/g, ' ')
      const runningText = toolDef?.runningText ?? toolReadableName
      const appToolExpandable = !!(toolDef?.showResult && result && !isStreaming)
      const inputSummary = toolDef?.inputSummaryField ? String(params[toolDef.inputSummaryField] ?? '') : ''
      let resultSummary = ''
      if (!isStreaming && result && toolDef?.resultSummaryField) {
        try { resultSummary = String(JSON.parse(result)[toolDef.resultSummaryField] ?? '') } catch {}
      }

      if (toolInterceptState) {
        return (
          <div className="tool-node my-0.5 rounded bg-muted/20 p-2">
            <div className="flex items-center gap-1.5 px-1 pb-1.5 text-xs text-muted-foreground">
              {canvasApp ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" /> : <ToolIcon icon="plug" className="size-3 shrink-0" />}
              <span>{appName}</span>
              <span className="text-muted-foreground/70">·</span>
              <span>{toolReadableName}</span>
              <span className="text-muted-foreground/70">· needs your input</span>
            </div>
            <ToolRendererFrame phase="intercept" state={toolInterceptState} />
          </div>
        )
      }

      if (toolDef?.standalone && canvasApp) {
        const tplKey = toolDef.renderer?.result?.template
        const tplPath = tplKey ? canvasApp.manifest.templates?.[tplKey] : undefined
        if (tplPath) {
          return (
            <StandaloneToolBlock
              appId={canvasApp.id}
              toolUseId={toolUseId ?? ''}
              toolName={mcpToolNamePart}
              appName={appName}
              toolReadableName={toolReadableName}
              args={params}
              result={result}
              isStreaming={isStreaming}
              templatePath={tplPath}
            />
          )
        }
      }

      const resultRendererCfg = toolDef?.renderer?.result
      const resultTemplatePath = resultRendererCfg && canvasApp?.manifest.templates
        ? canvasApp.manifest.templates[resultRendererCfg.template]
        : undefined
      if (!isStreaming && result && resultRendererCfg && resultTemplatePath && canvasApp) {
        let parsedResult: unknown = null
        try { parsedResult = JSON.parse(result) } catch { parsedResult = result }
        return (
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
            autoExpand={!!resultRendererCfg.autoExpand}
          />
        )
      }

      return (
        <AppToolBlock
          icon={canvasApp ? <MiniAppIcon appId={canvasApp.id} className="size-3.5 shrink-0" /> : <ToolIcon icon="plug" className="size-3 shrink-0 text-muted-foreground" />}
          appName={grouped ? undefined : appName}
          toolText={isStreaming ? runningText : toolReadableName}
          summary={isStreaming ? inputSummary : (resultSummary || inputSummary)}
          isStreaming={isStreaming}
          expandable={appToolExpandable}
          result={result}
        />
      )
    }
  }

  if (mcpInfo?.mcpToolName === 'widget_show') {
    const widgetData = result ? parseWidgetResult(result) : parsePartialWidgetInput(input)
    const jsonComplete = isCompleteJson(input)
    const inputComplete = !isStreaming || jsonComplete
    if (isStreaming && jsonComplete && widgetData) {
      window.app.trace?.('widget.ui', 'input_complete_early', { title: widgetData.title, inputLen: input.length })
    }
    if (widgetData) return <WidgetBlock data={widgetData} streaming={!inputComplete} />
    return (
      <CompactToolRow icon={<ToolIcon icon="canvas" className="size-3 shrink-0 text-muted-foreground" />}>
        <span className="font-medium text-foreground">
          {isStreaming ? <>{t('chat.toolBlock.generatingWidget')}</> : t('chat.toolBlock.generateWidget')}
        </span>
      </CompactToolRow>
    )
  }

  return (
    <div
      className={cn(
        'tool-node my-0.5 rounded transition-colors',
        isDenied ? 'denied bg-error/10' : isError ? 'errored bg-warning/10' : 'bg-muted/20',
        expandable && 'cursor-pointer',
        expandable && (isDenied ? 'hover:bg-error/20' : isError ? 'hover:bg-warning/20' : 'hover:bg-muted/40')
      )}
    >
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={expandable ? () => setExpanded((e) => !e) : undefined}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : isError ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : isMcp && mcpIconSrc ? (
          <img src={mcpIconSrc} alt={mcpInfo.serverName} className="size-3.5 shrink-0 rounded-sm object-cover" />
        ) : (
          <ToolIcon icon={display.icon} className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied && toolName !== 'AskUserQuestion' ? 'text-error' : isError ? 'text-warning' : 'text-foreground')}>
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName === 'AskUserQuestion' ? `Asked${display.summary ? ` ${display.summary}` : ''}` : displayName}
        </span>
        {isQuestionDismissed ? (
          <span className="shrink-0 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{t('chat.toolBlock.dismissed')}</span>
        ) : isDenied ? (
          <>
            {fileToolName ? (
              <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-error/20 px-1 py-px text-[10px] text-error">{t('chat.toolBlock.denied')}</span>
            {deniedFeedback && !feedbackIsBlock && (
              <span ref={feedbackRef} className="min-w-0 truncate text-error/70">{deniedFeedback}</span>
            )}
          </>
        ) : isError ? (
          <>
            {fileToolName ? (
              <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            ) : summary ? (
              <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
            ) : null}
            <span className="shrink-0 rounded bg-warning/20 px-1 py-px text-[10px] text-warning">{t('chat.toolBlock.error')}</span>
          </>
        ) : fileToolName ? (
          <>
            <FileChip name={fileToolName} title={display.summary} filePath={fileToolPath} />
            {toolName === 'FileChange' && params.kind && (
              <span className="text-muted-foreground">{String(params.kind)}</span>
            )}
            {toolName === 'Read' && formatReadMeta(params) && (
              <span className="text-muted-foreground">{formatReadMeta(params)}</span>
            )}
          </>
        ) : summary ? (
          <span className="min-w-0 truncate text-muted-foreground">{summary}</span>
        ) : null}
        {lineDelta && (lineDelta.added > 0 || lineDelta.removed > 0) && (
          <span className="shrink-0 font-mono text-[11px]">
            {lineDelta.added > 0 && (
              <span className="inline-flex items-baseline text-success">
                +<RollingNumber value={lineDelta.added} />
              </span>
            )}
            {lineDelta.added > 0 && lineDelta.removed > 0 && <span className="text-muted-foreground/50"> </span>}
            {lineDelta.removed > 0 && (
              <span className="inline-flex items-baseline text-error">
                -<RollingNumber value={lineDelta.removed} />
              </span>
            )}
          </span>
        )}
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className={cn('ml-auto shrink-0 transition-colors duration-500', getStallColor(stallLevel))}>{Math.round(elapsedSeconds)}s</span>
        )}
        {expandable && (
          <ChevronRight
            className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')}
          />
        )}
      </div>

      {deniedFeedback && feedbackIsBlock && (
        <div className="px-2 pb-1.5 text-xs text-error/70">{deniedFeedback}</div>
      )}

      {expandable && (
        <div
          ref={gridRef}
          className="grid transition-[grid-template-rows] duration-200 ease-out"
          style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-1.5">
              {expanded && (
                <>
                  {toolName === 'Edit' && (isStreaming
                    ? <CanvasEditDiff params={params} />
                    : <EditDiff params={params} />
                  )}
                  {toolName === 'Write' && <WriteDiff params={params} isStreaming={isStreaming} />}
                  {toolName === 'FileChange' && <FileChangeDiff params={params} isStreaming={isStreaming} />}
                  {isError && cleanResult && (
                    <div className="text-xs text-warning/90">{extractToolError(cleanResult)}</div>
                  )}
                  {hasResult && !isError && (!hasDiff || toolName === 'FileChange') && (
                    <div>
                      {isMcp ? <PrettyJSONCodeBlock text={cleanResult!} /> : <ToolResult text={cleanResult!} />}
                    </div>
                  )}
                  {hasQA && <QAResult text={cleanResult!} />}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})

export function FileChip({ name, title, filePath, lineNumber, className }: { name: string; title: string; filePath?: string; lineNumber?: number; className?: string }) {
  const parsed = filePath ? parseFileLinkTarget(filePath) : null
  const targetPath = parsed?.filePath
  const targetLineNumber = lineNumber ?? parsed?.lineNumber
  const dragEndRef = useRef(0)

  const handleClick = (e: React.MouseEvent): void => {
    if (Date.now() - dragEndRef.current < 200) return
    if (clickReleasedOnSelection(e.currentTarget)) return
    e.stopPropagation()
    if (!targetPath) return
    const projectPath = useChatStore.getState().activeProject
    if (!projectPath) return
    const relative = targetPath.startsWith(projectPath + '/') ? targetPath.slice(projectPath.length + 1) : targetPath
    useSourceControlStore.getState().selectFile(projectPath, relative, targetLineNumber)
    openFileTab(relative)
  }
  return (
    <span
      role="button"
      onClick={handleClick}
      title={title}
      className="inline-flex min-w-0 cursor-pointer items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-foreground hover:bg-muted/80 transition-colors"
    >
      <DraggableFileIcon name={name} filePath={targetPath} dragEndRef={dragEndRef} className="shrink-0" />
      <span className={cn('truncate', className)}>{name}</span>
      {targetLineNumber != null && <span className="text-muted-foreground text-[10px]">#L{targetLineNumber}</span>}
    </span>
  )
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

interface MobileShareResult {
  ok?: boolean
  name?: string
  size?: number
  mimeType?: string
  deviceName?: string
  sentAt?: number
  path?: string
  transport?: 'inline' | 'relay'
  expiresAt?: number
}

function MobileShareFileBlock({ params, result, isStreaming }: {
  params: Record<string, unknown>
  result: string | null
  isStreaming: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const path = String(params.path ?? '')
  const fileName = path.split('/').pop() || path
  const progress = useShareProgress(path)

  let parsed: MobileShareResult | null = null
  if (!isStreaming && result) {
    try { parsed = JSON.parse(result) as MobileShareResult } catch { /* not JSON */ }
  }
  const done = !!parsed?.ok
  const failed = !isStreaming && !done
  const errorText = failed ? (result ?? '').replace(/^\[Error\]\s*/, '').trim() : ''

  const fileChip = <FileChip name={fileName} title={path} filePath={path} className="max-w-[180px]" />

  const header = (
    <div
      className={cn('flex items-center gap-1.5 px-2 py-1.5 text-xs', done && 'cursor-pointer')}
      onClick={done ? () => setExpanded((e) => !e) : undefined}
    >
      {done
        ? <Smartphone className="size-3 shrink-0 text-muted-foreground" />
        : failed
          ? <Ban className="size-3 shrink-0 text-destructive" />
          : <Upload className="size-3 shrink-0 text-primary" />}
      <span className={cn('shrink-0', failed ? 'text-destructive' : 'text-foreground')}>{done ? 'Sent' : failed ? 'Failed to send' : 'Sending'}</span>
      {fileChip}
      {done && parsed?.deviceName && (
        <>
          <span className="shrink-0 text-muted-foreground">to</span>
          <span className="min-w-0 truncate text-foreground">{parsed.deviceName}</span>
        </>
      )}
      {failed && errorText && (
        <span className="min-w-0 truncate text-muted-foreground">{errorText}</span>
      )}
      {!done && !failed && progress && (
        <span className="ml-auto shrink-0 tabular-nums text-primary">
          {formatBytes(progress.loaded)} / {formatBytes(progress.total)}
        </span>
      )}
      {done && (
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      )}
    </div>
  )

  if (!done) {
    return <div className="tool-node my-0.5 rounded bg-muted/20">{header}</div>
  }

  const sentAt = parsed?.sentAt ? new Date(parsed.sentAt) : null
  const rows: Array<{ label: string; value: React.ReactNode }> = []
  if (sentAt) rows.push({ label: 'Sent at', value: <span className="tabular-nums">{sentAt.toLocaleString()}</span> })
  rows.push({ label: 'Path', value: <span className="font-mono text-[11px] text-primary break-all">{parsed?.path ?? path}</span> })
  if (parsed?.size != null) rows.push({ label: 'Size', value: `${formatBytes(parsed.size)}${parsed.mimeType ? ` · ${parsed.mimeType}` : ''}` })
  rows.push({
    label: 'Delivery',
    value: parsed?.transport === 'relay'
      ? <span className="text-muted-foreground">Encrypted link{parsed.expiresAt ? ` · expires ${new Date(parsed.expiresAt).toLocaleTimeString()}` : ''}</span>
      : <span className="text-muted-foreground">Delivered inline · encrypted</span>,
  })

  return (
    <div className="tool-node my-0.5 rounded bg-muted/20">
      {header}
      <div className="grid transition-[grid-template-rows] duration-200 ease-out" style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="border-t border-border/60 px-2 py-2">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px]">
              {rows.map((r) => (
                <div key={r.label} className="contents">
                  <span className="text-muted-foreground">{r.label}</span>
                  <span className="min-w-0 text-foreground">{r.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

const BASH_LOAD_CHUNK = 50

function BashTerminalView({
  toolUseId,
  command,
  description,
  fallbackResult,
  isStreaming,
  isDenied,
  isError,
  timeoutMs,
  isTimedOut,
  resultOutputPath,
  runInBackground,
  autoExpand,
  backgroundActivity,
}: {
  toolUseId: string
  command: string
  description?: string
  fallbackResult?: string
  isStreaming: boolean
  isDenied?: boolean
  isError?: boolean
  timeoutMs?: number
  isTimedOut?: boolean
  resultOutputPath?: string
  runInBackground?: boolean
  autoExpand?: boolean
  backgroundActivity?: boolean
}) {
  const bashOutput = useBashOutput(toolUseId)
  const { t } = useTranslation()
  const outputExpired = !!resultOutputPath && !bashOutput && !isStreaming
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isLiveRunning = !!bashOutput && !bashOutput.finished
  const taskProgress = useActiveSession((s) => s.taskProgress[toolUseId])
  const isPendingPermission = useActiveSession((s) => s.pendingPermissions.some((p) => p.toolUseId === toolUseId))
  const hasResult = !!fallbackResult || isDenied
  const isRunning = (isStreaming && !hasResult && !isPendingPermission) || isLiveRunning
  const hasTaskState = !!taskProgress
  const bgFailed = taskProgress?.status === 'failed'
  const bgStopped = !!taskProgress?.status && taskProgress.status !== 'completed' && !bgFailed
  const showError = (isError || bgFailed) && !isDenied
  const treatAsBackground = backgroundActivity || runInBackground
  const holdOpenForBackgroundTask = treatAsBackground
    ? (hasTaskState ? taskProgress.completed !== true : isRunning)
    : false
  const autoExpanded = holdOpenForBackgroundTask
  const [expanded, setExpanded] = useState(autoExpand ? autoExpanded : false)
  const [extraContent, setExtraContent] = useState('')
  const [loadedLines, setLoadedLines] = useState(BASH_LOAD_CHUNK)
  const [hasMore, setHasMore] = useState(true)
  const loadingRef = useRef(false)
  const prevExtraRef = useRef('')
  const prevScrollHeightRef = useRef(0)
  const [restoredContent, setRestoredContent] = useState<string | null>(outputExpired ? null : '')
  const restoredRef = useRef(false)

  useEffect(() => {
    if (autoExpand) setExpanded(autoExpanded)
    else setExpanded(false)
  }, [autoExpand, autoExpanded])

  useEffect(() => {
    if (!outputExpired || !resultOutputPath || restoredRef.current) return
    restoredRef.current = true
    window.app.readBashOutputFile(resultOutputPath, 50).then((result) => {
      setRestoredContent(result || '')
    })
  }, [outputExpired, resultOutputPath])

  const liveContent = outputExpired
    ? (restoredContent || '')
    : (bashOutput?.content || fallbackResult || '')
  const liveContentRef = useRef(liveContent)
  liveContentRef.current = liveContent
  const outputPath = bashOutput?.outputPath || (restoredContent ? resultOutputPath : undefined)
  const isLive = isLiveRunning
  const timerActive = isRunning
  const content = extraContent ? extraContent + '\n' + liveContent : liveContent
  const fileExpired = outputExpired && restoredContent === ''

  const [localElapsed, setLocalElapsed] = useState(0)
  const startTimeRef = useRef(0)
  useEffect(() => {
    if (!timerActive) {
      startTimeRef.current = 0
      setLocalElapsed(0)
      return
    }
    if (!startTimeRef.current) startTimeRef.current = Date.now()
    const tick = (): void => setLocalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [timerActive])

  useEffect(() => {
    if (isLive && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [liveContent, isLive])

  useLayoutEffect(() => {
    if (extraContent && extraContent !== prevExtraRef.current) {
      const el = scrollRef.current
      if (el) el.scrollTop = el.scrollHeight - prevScrollHeightRef.current
      prevExtraRef.current = extraContent
    }
  }, [extraContent])

  const loadMore = useCallback(async () => {
    if (!outputPath || isLive || loadingRef.current || !hasMore) return
    loadingRef.current = true
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? 0
    const nextLines = loadedLines + BASH_LOAD_CHUNK
    const result = outputExpired
      ? await window.app.readBashOutputFile(outputPath, nextLines)
      : await window.app.readBashOutputMore(toolUseId, nextLines)
    const resultLineCount = result.split('\n').length
    if (resultLineCount <= loadedLines) {
      setHasMore(false)
    } else {
      const lc = liveContentRef.current
      const tail = result.split('\n').slice(0, -lc.split('\n').length)
      setExtraContent(tail.join('\n'))
      setLoadedLines(nextLines)
    }
    loadingRef.current = false
  }, [toolUseId, outputPath, outputExpired, isLive, hasMore, loadedLines])

  useEffect(() => {
    if (isLive || !expanded || !hasMore || !outputPath) return
    const el = scrollRef.current
    const sentinel = sentinelRef.current
    if (!el || !sentinel) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMore() },
      { root: el, threshold: 0.1 }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [isLive, expanded, hasMore, outputPath, loadMore])

  return (
    <div className={cn(
      'tool-node my-0.5 rounded transition-colors cursor-pointer',
      isDenied ? 'denied bg-error/10 hover:bg-error/20' : showError ? 'errored bg-warning/10 hover:bg-warning/20' : 'bg-muted/20 hover:bg-muted/40',
      expanded && 'overflow-hidden',
    )}>
      <div
        className="flex items-center gap-1.5 px-2 py-1.5 text-xs"
        onClick={() => setExpanded((e) => !e)}
      >
        {isDenied ? (
          <Ban className="size-3 shrink-0 text-error" />
        ) : showError ? (
          <TriangleAlert className="size-3 shrink-0 text-warning" />
        ) : (
          <ToolIcon icon="terminal" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className={cn('font-medium', isDenied ? 'text-error' : showError ? 'text-warning' : 'text-foreground', isRunning && !isDenied && 'animate-shimmer')}>
          {isRunning && !isDenied ? t('chat.toolBlock.running') : 'Bash'}
        </span>
        {isRunning && localElapsed >= 1 && <span className="text-muted-foreground tabular-nums">{localElapsed}s</span>}
        {description
          ? <span className="min-w-0 truncate text-muted-foreground">{description}</span>
          : (!expanded || fileExpired) && <span className="min-w-0 truncate text-muted-foreground">{command}</span>
        }
        {timeoutMs && <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{Math.round(timeoutMs / 1000)}s</span>}
        {isDenied && <span className="rounded bg-error/20 px-1 py-px text-[10px] text-error">Denied</span>}
        {showError && <span className="rounded bg-warning/20 px-1 py-px text-[10px] text-warning">{t('chat.toolBlock.error')}</span>}
        {bgStopped && !showError && <span className="rounded bg-muted px-1 py-px text-[10px] text-muted-foreground">{t('chat.subagent.stopped')}</span>}
        {isTimedOut && <span className="rounded bg-error/20 px-1 py-px text-[10px] text-error">{t('chat.toolBlock.timedOut')}</span>}
        <ChevronRight className={cn('ml-auto size-3 shrink-0 text-muted-foreground transition-transform duration-200', expanded && 'rotate-90')} />
      </div>
      {expanded && (fileExpired ? (
        <div className="px-3 py-1.5 text-xs text-muted-foreground/50 italic">
          {t('chat.toolBlock.outputFileExpired', { path: resultOutputPath!.split('/').pop() })}
        </div>
      ) : (
        <div className="bg-terminal-bg font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
          {command && (
            <div className="px-3 pt-2 text-terminal-fg">
              <span className="text-terminal-prompt">$ </span>{command}
            </div>
          )}
          <div
            ref={scrollRef}
            className="max-h-24 overflow-y-auto overflow-x-auto px-3 py-1.5"
          >
            {!isLive && hasMore && outputPath && <div ref={sentinelRef} className="h-px" />}
            {outputExpired && restoredContent === null ? (
              <div className="animate-shimmer text-terminal-dim">{t('common.loading')}</div>
            ) : content ? (
              <div className={showError ? 'text-amber-300' : 'text-terminal-muted'}><AnsiText text={showError ? extractToolError(content) : content} /></div>
            ) : isStreaming ? (
              <div className="text-terminal-muted">
                <span className="animate-shimmer">{t('chat.toolBlock.runningInline')}</span>{localElapsed >= 1 && <span className="text-terminal-dim"> {localElapsed}s{timeoutMs && !isLive ? ` · timeout ${Math.round(timeoutMs / 1000)}s` : ''}</span>}
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

const RESULT_PREVIEW_LINES = 10

/** Truncated tool output with secondary expand for long results. */
function ToolResult({ text }: { text: string }) {
  const { t } = useTranslation()
  const lines = text.split('\n')
  const isLong = lines.length > RESULT_PREVIEW_LINES
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - RESULT_PREVIEW_LINES

  const visibleText = showAll || !isLong ? text : lines.slice(0, RESULT_PREVIEW_LINES).join('\n')

  return (
    <div>
      <div className="overflow-x-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
        {visibleText}
      </div>
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? t('chat.toolBlock.collapse') : t('chat.toolBlock.moreLines', { count: hiddenCount })}
        </button>
      )}
    </div>
  )
}

/** Prettified JSON code block with syntax highlighting and truncation. */
function PrettyJSONCodeBlock({ text }: { text: string }) {
  const { t } = useTranslation()
  const jsonResult = useMemo(() => tryPrettifyJson(text), [text])
  const prettified = jsonResult ?? text
  const language = jsonResult ? 'json' : 'text'
  const lines = prettified.split('\n')
  const previewLines = 20
  const isLong = lines.length > previewLines
  const [showAll, setShowAll] = useState(false)
  const hiddenCount = lines.length - previewLines
  const visibleText = showAll || !isLong ? prettified : lines.slice(0, previewLines).join('\n')

  return (
    <div className="-mx-2">
      <HighlightedCodeBlock code={visibleText} language={language} codePlugin={codePlugin} />
      {isLong && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowAll((s) => !s) }}
          className="mt-0.5 ml-2 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronRight className={cn('size-3 shrink-0 transition-transform duration-200', showAll && 'rotate-90')} />
          {showAll ? t('chat.toolBlock.collapse') : t('chat.toolBlock.moreLines', { count: hiddenCount })}
        </button>
      )}
    </div>
  )
}

/** Render AskUserQuestion result as Q&A pairs. */
function QAResult({ text }: { text: string }) {
  const pairs = parseQAPairs(text)
  if (pairs.length === 0) return null

  return (
    <div className="space-y-1">
      {pairs.map((pair, i) => (
        <div key={i} className="rounded bg-background/70 px-2 py-1.5 text-[11px] leading-relaxed">
          <div className="text-muted-foreground">{pair.question}</div>
          <div className="text-success">{pair.answer}</div>
        </div>
      ))}
    </div>
  )
}


/** Build unified diff lines with actual file line numbers. */
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

  const isDenied = !!result && result.startsWith('[denied] ')
  const resultOutcome = result
    ? (isDenied ? { approved: false, feedback: result.slice('[denied] '.length) } : { approved: true })
    : null
  const outcome = resultOutcome ?? liveOutcome

  if (!outcome) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-muted/20 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-muted-foreground" />
        <span className="font-medium text-muted-foreground">Review Plan</span>
      </div>
    )
  }

  if (outcome.approved) {
    return (
      <div className="my-4 flex items-center gap-1.5 rounded bg-success/10 px-2 py-1.5 text-sm">
        <PenLine className="size-3 shrink-0 text-success" />
        <span className="font-medium text-success">Plan Approved</span>
        <Check className="ml-auto size-3 shrink-0 text-success" />
      </div>
    )
  }

  return (
    <div className="my-4 rounded bg-error/10 px-2 py-1.5 text-sm">
      <div className="flex items-center gap-1.5">
        <PenLine className="size-3 shrink-0 text-error" />
        <span className="font-medium text-error">Plan Rejected</span>
        <X className="ml-auto size-3 shrink-0 text-error" />
      </div>
      {outcome.feedback && outcome.feedback !== 'User rejected the plan' && (
        <div className="mt-1 text-xs text-error/70">{outcome.feedback}</div>
      )}
    </div>
  )
}

/** Debug view showing raw input and output for a tool call. */
export function DebugToolBlock({
  toolName,
  input,
  result,
  status,
  elapsedSeconds,
}: {
  toolName: string
  input: string
  result?: string
  status?: 'streaming' | 'complete'
  elapsedSeconds?: number
}) {
  const isStreaming = status === 'streaming'
  const prettyInput = tryPrettifyJson(input) ?? input

  return (
    <div className="my-0.5 rounded border border-amber-500/30 bg-muted/20">
      <div className="flex items-center gap-1.5 px-2 py-1.5 text-xs">
        <span className="size-3 shrink-0 text-center text-warning">&#9881;</span>
        <span className="font-medium text-warning">
          {isStreaming ? <>{getToolVerb(toolName)}…</> : toolName}
        </span>
        <span className="rounded bg-warning/20 px-1 py-px text-[10px] text-warning">debug</span>
        {isStreaming && elapsedSeconds != null && elapsedSeconds >= 1 && (
          <span className="ml-auto shrink-0 text-muted-foreground">{Math.round(elapsedSeconds)}s</span>
        )}
      </div>
      <div className="px-2 pb-1.5 space-y-1.5">
        <div>
          <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Input</div>
          <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground whitespace-pre-wrap break-all">
            {prettyInput || <span className="text-muted-foreground italic">empty</span>}
          </div>
        </div>
        {result && !isStreaming && (
          <div>
            <div className="mb-0.5 text-[10px] font-medium uppercase text-muted-foreground">Output</div>
            <div className="max-h-48 overflow-auto rounded bg-background/70 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground whitespace-pre-wrap break-all">
              {result}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

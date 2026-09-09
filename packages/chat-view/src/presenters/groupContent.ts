import type { ContentBlock } from '@superone/shared/agent-types'
import { isToolResultBlock } from '@superone/shared/content-delta'

/** Host-specific classification needed by the otherwise pure grouping pass. */
export interface GroupContentPorts {
  isSubagentToolName(toolName: string): boolean
  isWorkflowSmokeCheck(input: string): boolean
  isHiddenToolBlock(toolName: string, result?: string): boolean
  resolveAppTool(toolName: string, input: string): {
    appId: string
    groupable: boolean
    standalone: boolean
  } | null
}

/** Tools whose consecutive calls can be collapsed into a summary group. */
const COLLAPSIBLE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'])

export type RenderSegment =
  | { kind: 'block'; block: ContentBlock; index: number }
  | { kind: 'thinking'; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'tools'; blocks: ContentBlock[]; startIndex: number }
  | { kind: 'app-tools'; appId: string; blocks: ContentBlock[]; startIndex: number }
  | {
    kind: 'subagent'
    taskBlock: ContentBlock & { type: 'tool_use' }
    childBlocks: ContentBlock[]
    resultBlock?: ContentBlock
    startIndex: number
  }
  | {
    kind: 'workflow'
    toolBlock: ContentBlock & { type: 'tool_use' }
    resultBlock?: ContentBlock
    startIndex: number
  }

export interface GroupContentResult {
  segments: RenderSegment[]
  toolNameMap: Map<string, string>
  toolResultMap: Map<string, string>
  timedOutToolIds: Set<string>
  errorToolIds: Set<string>
  outputPathMap: Map<string, string>
}

/** Group renderable content without importing stores, Electron, or concrete UI components. */
export function groupContentPresenter(
  content: ContentBlock[],
  ports: GroupContentPorts,
): GroupContentResult {
  const toolNameMap = new Map<string, string>()
  const toolResultMap = new Map<string, string>()
  const timedOutToolIds = new Set<string>()
  const errorToolIds = new Set<string>()
  const outputPathMap = new Map<string, string>()
  const taskToolUseIds = new Set<string>()

  for (const block of content) {
    // `isToolResultBlock`, not `type === 'tool_result'`: the projection sent to
    // the phone rewrites Bash and Todo outcomes into `bash_result` / `todo_result`.
    // Indexing only the desktop shape left every projected Bash row resultless,
    // shimmering "Running…" with its output rendered nowhere.
    if (block.type === 'tool_use') {
      toolNameMap.set(block.toolUseId, block.toolName)
      if (ports.isSubagentToolName(block.toolName)) taskToolUseIds.add(block.toolUseId)
    } else if (isToolResultBlock(block)) {
      if (block.summary) toolResultMap.set(block.toolUseId, block.summary)
      if ('isTimedOut' in block && block.isTimedOut) timedOutToolIds.add(block.toolUseId)
      if ('isError' in block && block.isError) errorToolIds.add(block.toolUseId)
      if ('outputPath' in block && block.outputPath) outputPathMap.set(block.toolUseId, block.outputPath)
    }
  }

  const appToolIdToAppId = new Map<string, string>()
  for (const block of content) {
    if (block.type !== 'tool_use') continue
    const resolved = ports.resolveAppTool(block.toolName, block.input)
    if (!resolved || resolved.standalone || !resolved.groupable) continue
    appToolIdToAppId.set(block.toolUseId, resolved.appId)
  }

  const segments: RenderSegment[] = []
  let group: ContentBlock[] = []
  let groupStart = 0
  let appGroup: ContentBlock[] = []
  let appGroupId: string | null = null
  let appGroupStart = 0

  const activeSubagents = new Map<string, RenderSegment & { kind: 'subagent' }>()
  const activeWorkflows = new Map<string, RenderSegment & { kind: 'workflow' }>()
  const agentToParent = new Map<string, string | null>()

  const topAncestorSubagent = (parentId: string | null): string | null => {
    let current = parentId
    const seen = new Set<string>()
    while (current && agentToParent.has(current) && !seen.has(current)) {
      seen.add(current)
      const parent = agentToParent.get(current) ?? null
      if (parent == null) break
      current = parent
    }
    return current && activeSubagents.has(current) ? current : null
  }

  const flush = (): void => {
    if (group.length === 0) return
    segments.push({ kind: 'tools', blocks: group, startIndex: groupStart })
    group = []
  }

  const flushAppGroup = (): void => {
    if (appGroup.length === 0) return
    segments.push({
      kind: 'app-tools',
      appId: appGroupId!,
      blocks: appGroup,
      startIndex: appGroupStart,
    })
    appGroup = []
    appGroupId = null
  }

  for (let index = 0; index < content.length; index++) {
    const block = content[index]
    const parentId = 'parentToolUseId' in block ? block.parentToolUseId ?? null : null

    if (parentId) {
      if (block.type === 'tool_use' && ports.isSubagentToolName(block.toolName)) {
        agentToParent.set(block.toolUseId, parentId)
      }
      const top = topAncestorSubagent(parentId)
      if (top) {
        activeSubagents.get(top)!.childBlocks.push(block)
        continue
      }
    }

    // Background agents can emit their result before later child blocks, so keep
    // the collector open after attaching the result.
    if (
      isToolResultBlock(block)
      && taskToolUseIds.has(block.toolUseId)
      && activeSubagents.has(block.toolUseId)
    ) {
      activeSubagents.get(block.toolUseId)!.resultBlock = block
      continue
    }

    if (block.type === 'tool_use' && ports.isSubagentToolName(block.toolName)) {
      flush()
      flushAppGroup()
      const segment: RenderSegment & { kind: 'subagent' } = {
        kind: 'subagent',
        taskBlock: block,
        childBlocks: [],
        startIndex: index,
      }
      segments.push(segment)
      activeSubagents.set(block.toolUseId, segment)
      agentToParent.set(block.toolUseId, null)
      continue
    }

    if (isToolResultBlock(block) && activeWorkflows.has(block.toolUseId)) {
      activeWorkflows.get(block.toolUseId)!.resultBlock = block
      activeWorkflows.delete(block.toolUseId)
      continue
    }

    if (
      block.type === 'tool_use'
      && block.toolName === 'Workflow'
      && !ports.isWorkflowSmokeCheck(block.input)
    ) {
      flush()
      flushAppGroup()
      const segment: RenderSegment & { kind: 'workflow' } = {
        kind: 'workflow',
        toolBlock: block,
        startIndex: index,
      }
      segments.push(segment)
      activeWorkflows.set(block.toolUseId, segment)
      continue
    }

    if (block.type === 'tool_use' && appToolIdToAppId.has(block.toolUseId)) {
      flush()
      const blockAppId = appToolIdToAppId.get(block.toolUseId)!
      if (appGroupId !== blockAppId) {
        flushAppGroup()
        appGroupId = blockAppId
        appGroupStart = index
      }
      appGroup.push(block)
      continue
    }
    if (isToolResultBlock(block) && appToolIdToAppId.has(block.toolUseId)) {
      appGroup.push(block)
      continue
    }

    flushAppGroup()
    if (block.type === 'tool_use' && COLLAPSIBLE_TOOLS.has(block.toolName)) {
      if (group.length === 0) groupStart = index
      group.push(block)
    } else if (
      isToolResultBlock(block)
      && COLLAPSIBLE_TOOLS.has(toolNameMap.get(block.toolUseId) ?? '')
    ) {
      group.push(block)
    } else if (
      (block.type === 'tool_use'
        && ports.isHiddenToolBlock(block.toolName, toolResultMap.get(block.toolUseId)))
      || (isToolResultBlock(block)
        && ports.isHiddenToolBlock(
          toolNameMap.get(block.toolUseId) ?? '',
          toolResultMap.get(block.toolUseId),
        ))
    ) {
      flush()
    } else if (block.type === 'thinking') {
      flush()
      const last = segments[segments.length - 1]
      if (last?.kind === 'thinking') last.blocks.push(block)
      else segments.push({ kind: 'thinking', blocks: [block], startIndex: index })
    } else {
      flush()
      segments.push({ kind: 'block', block, index })
    }
  }

  flush()
  flushAppGroup()
  return {
    segments,
    toolNameMap,
    toolResultMap,
    timedOutToolIds,
    errorToolIds,
    outputPathMap,
  }
}

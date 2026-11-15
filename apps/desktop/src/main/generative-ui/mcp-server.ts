import { superoneHome } from '../superone-home'
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { checkCdnViolations } from '@superone/shared/generative-ui/cdn-allowlist'
import { isNativeTemplateId, nativeTypeFromTemplateId, NATIVE_WIDGET_TYPES } from '@superone/shared/generative-ui/native-widgets'
import { readWidgetShowArgs, widgetCdnWarning, widgetShowShortContent } from '@superone/shared/generative-ui/widget-data'
import { HOST_ACTION_WIDGET_DESCRIPTORS, WIDGET_SAVE_DESCRIPTOR } from '@superone/shared/environment/host-action-widget-descriptors'
import { jsonObjectRecord } from '@superone/shared/json-object-string'
import { jsonSchemaToZodShape } from '../mcp/json-schema-zod'
import { buildWidgetPayload } from './widget-payload'
import type { TemplateRoots } from './template-store'

interface WidgetToolsOptions {
  skipWidgetGate?: boolean
  /**
   * Whether a desktop view is drawing this session right now. The ready gate only
   * exists for that view; a session driven from the phone with nothing open on the
   * desktop has no frame to wait for, and waiting would hang the call.
   */
  isShownOnDesktop?: () => boolean
  projectPath?: string
  /** Scopes where agent-supplied media bytes are written, mirroring media_generate_*. */
  sessionId?: string
  /**
   * The directory the agent is working in *right now* — its worktree after `setCwd`, not the
   * project identity `projectPath` carries. Read at call time because the MCP transport is
   * registered once per session and would otherwise freeze a stale value.
   */
  resolveSessionRoot?: () => string | undefined
  /**
   * Async context provider for `@native/files-previewer` — supplies a
   * remote-node session's live root and per-file resolver. When it resolves to
   * undefined the local `resolveSessionRoot` path is used.
   */
  resolvePreviewerContext?: () => Promise<import('./files-previewer-payload').PreviewerBuildContext | undefined>
  /**
   * Whether this call's model gets the short acknowledgement instead of the payload.
   * Read at call time: it depends on who is calling. Absent means the full payload.
   */
  shortensResult?: () => boolean
}

function templateRoots(opts?: WidgetToolsOptions): TemplateRoots {
  return { project: opts?.projectPath, user: superoneHome() }
}

export async function listWidgetTemplatesHandler(opts?: WidgetToolsOptions) {
  const { listTemplates, formatTemplateList } = await import('./template-store')
  const { formatNativeTemplateList } = await import('./native-widget-payload')
  const formatted = formatTemplateList(listTemplates(templateRoots(opts)))
  const saved = formatted || '# Saved widget templates\n\nNo saved templates are available.'
  // Native templates lead: they are always available and are the right answer whenever the agent
  // would otherwise hand-write a gallery, so they should be seen before the saved list.
  return { content: [{ type: 'text' as const, text: `${formatNativeTemplateList()}\n\n${saved}` }] }
}

/**
 * Render one of SuperOne's own surfaces instead of a frame.
 *
 * Returns the prepared payload as the tool result: the chat row hides itself once this parses and
 * the turn-end gallery picks the items up, so the call *is* the UI rather than a card describing it.
 */
async function executeNativeWidget(
  template: string,
  title: string,
  data: Record<string, unknown> | undefined,
  opts?: WidgetToolsOptions,
) {
  const nativeType = nativeTypeFromTemplateId(template)
  if (!nativeType) {
    const known = NATIVE_WIDGET_TYPES.map((t) => `@native/${t}`).join(', ')
    return {
      content: [{ type: 'text' as const, text: `[Error] Unknown native template "${template}". Available: ${known}.` }],
      isError: true as const,
    }
  }

  if (nativeType === 'files-previewer') {
    const { buildFilesPreviewerPayload } = await import('./files-previewer-payload')
    const remoteContext = opts?.resolvePreviewerContext ? await opts.resolvePreviewerContext() : undefined
    const root = remoteContext?.root ?? opts?.resolveSessionRoot?.() ?? opts?.projectPath
    if (!root) {
      return {
        content: [{ type: 'text' as const, text: '[Error] @native/files-previewer needs a session working directory to resolve paths against; none is available here.' }],
        isError: true as const,
      }
    }
    const built = await buildFilesPreviewerPayload(title, data, remoteContext ?? { root })
    if (!built.payload) {
      return { content: [{ type: 'text' as const, text: built.error ?? '[Error] widget_show failed.' }], isError: true as const }
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify(built.payload) }] }
  }

  const { mediaGenOutputDir } = await import('../media-gen/paths')
  const { mediaFileGrants } = await import('../media-file-grants')
  const { buildNativeWidgetPayload } = await import('./native-widget-payload')
  const built = buildNativeWidgetPayload(nativeType, title, data, {
    outputDir: mediaGenOutputDir(opts?.sessionId),
    generationId: randomUUID(),
    grantFile: (path) => mediaFileGrants().add(path),
  })
  if (!built.payload) {
    return { content: [{ type: 'text' as const, text: built.error ?? '[Error] widget_show failed.' }], isError: true as const }
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(built.payload) }] }
}

/** Shared by in-process MCP registration and Host Action / listSuperoneMcpTools. */
export async function executeWidgetShowTool(
  args: Record<string, unknown>,
  opts?: WidgetToolsOptions,
) {
  const showArgs = readWidgetShowArgs(args)
  const { title, widget_code, template, data } = showArgs

  // The `@native/` namespace is unreachable by a saved template id (those match
  // /^[a-z0-9][a-z0-9_-]*$/), so this branch can never shadow a user's own template.
  if (template && isNativeTemplateId(template)) {
    return executeNativeWidget(template, title, data, opts)
  }

  const built = buildWidgetPayload(templateRoots(opts), showArgs)
  if (!built.payload) {
    return { content: [{ type: 'text' as const, text: built.error ?? 'widget_show failed.' }], isError: true }
  }
  const content: { type: 'text'; text: string }[] = [{ type: 'text', text: JSON.stringify(built.payload) }]
  const warning = widget_code ? widgetCdnWarning(checkCdnViolations(widget_code)) : null
  if (warning) content.push({ type: 'text', text: warning })
  if (!opts?.skipWidgetGate && !template && opts?.isShownOnDesktop?.()) {
    const { waitForWidgetReady } = await import('./widget-gate')
    await waitForWidgetReady(title)
  }
  // A `widget_code` call's surfaces redraw it from the input; a template's code is not in it.
  if (widget_code && opts?.shortensResult?.()) return { content: widgetShowShortContent(showArgs) }
  return { content }
}

export async function executeWidgetSaveTool(
  args: Record<string, unknown>,
  opts?: WidgetToolsOptions,
) {
  const id = typeof args.id === 'string' ? args.id : ''
  const title = typeof args.title === 'string' ? args.title : ''
  const code = typeof args.code === 'string' ? args.code : ''
  const description = typeof args.description === 'string' ? args.description : undefined
  const inputSchema = jsonObjectRecord(args.inputSchema)
  const layout = args.layout === 'fluid' || args.layout === 'fixed' ? args.layout : undefined
  const scope = args.scope === 'project' || args.scope === 'user' ? args.scope : undefined
  const roots = templateRoots(opts)
  const target = scope ?? 'project'
  if (target === 'project' && !roots.project) {
    return { content: [{ type: 'text' as const, text: 'No project is open, so this template can only be saved with scope "user".' }], isError: true }
  }
  try {
    const { allocateTemplateId, saveTemplate } = await import('./template-store')
    const resolvedId = allocateTemplateId(roots, id, target)
    const existed = resolvedId === id
    const saved = saveTemplate(roots, { id: resolvedId, scope: target, code, title, description, inputSchema, layout })
    return {
      content: [{
        type: 'text' as const,
        text: `${existed ? 'Updated' : 'Saved'} widget template "${saved.id}" (${target} scope, v${saved.version}). `
          + `Re-render it with widget_show({ template: "${saved.id}", data: { ... } }).`,
      }],
    }
  } catch (err) {
    return { content: [{ type: 'text' as const, text: `Could not save widget template: ${err instanceof Error ? err.message : String(err)}` }], isError: true }
  }
}

const WIDGET_TOOL_DESCRIPTORS = [...HOST_ACTION_WIDGET_DESCRIPTORS, WIDGET_SAVE_DESCRIPTOR]

/** In-process registration uses the same schema the stdio bridge advertises. */
function registerWidgetTool(
  server: McpServer,
  name: string,
  handler: (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>,
): void {
  const descriptor = WIDGET_TOOL_DESCRIPTORS.find((tool) => tool.name === name)
  if (!descriptor) throw new Error(`Missing widget tool descriptor: ${name}`)
  server.registerTool(name, {
    description: descriptor.description,
    inputSchema: jsonSchemaToZodShape(descriptor.inputSchema),
  }, async (args) => handler(args as Record<string, unknown>))
}

export function registerWidgetTools(server: McpServer, opts?: WidgetToolsOptions): void {
  registerWidgetTool(server, 'widget_list_templates', () => listWidgetTemplatesHandler(opts))
  registerWidgetTool(server, 'widget_show', (args) => executeWidgetShowTool(args, opts))
  registerWidgetTool(server, 'widget_save', (args) => executeWidgetSaveTool(args, opts))
}

import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { checkCdnViolations } from '@superone/shared/generative-ui/cdn-allowlist'
import { isNativeTemplateId, nativeTypeFromTemplateId, NATIVE_WIDGET_TYPES } from '@superone/shared/generative-ui/native-widgets'
import { buildWidgetPayload } from './widget-payload'
import type { TemplateRoots } from './template-store'

interface WidgetToolsOptions {
  skipWidgetGate?: boolean
  projectPath?: string
  /** Scopes where agent-supplied media bytes are written, mirroring media_generate_*. */
  sessionId?: string
}

function templateRoots(opts?: WidgetToolsOptions): TemplateRoots {
  return { project: opts?.projectPath, user: homedir() }
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

  const { mediaGenOutputDir } = await import('../media-gen/paths')
  const { buildNativeWidgetPayload } = await import('./native-widget-payload')
  const built = buildNativeWidgetPayload(nativeType, title, data, {
    outputDir: mediaGenOutputDir(opts?.sessionId),
    generationId: randomUUID(),
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
  const title = String(args.title ?? '')
  const widget_code = typeof args.widget_code === 'string' ? args.widget_code : undefined
  const template = typeof args.template === 'string' ? args.template : undefined
  const data =
    args.data && typeof args.data === 'object' && !Array.isArray(args.data)
      ? (args.data as Record<string, unknown>)
      : undefined
  const reusable =
    args.reusable && typeof args.reusable === 'object' && !Array.isArray(args.reusable)
      ? (args.reusable as {
          id: string
          description?: string
          inputSchema?: Record<string, unknown>
        })
      : undefined
  const width = typeof args.width === 'number' ? args.width : undefined
  const height = typeof args.height === 'number' ? args.height : undefined

  // The `@native/` namespace is unreachable by a saved template id (those match
  // /^[a-z0-9][a-z0-9_-]*$/), so this branch can never shadow a user's own template.
  if (template && isNativeTemplateId(template)) {
    return executeNativeWidget(template, title, data, opts)
  }

  const built = buildWidgetPayload(templateRoots(opts), {
    title,
    widget_code,
    template,
    data,
    reusable,
    width,
    height,
  })
  if (!built.payload) {
    return { content: [{ type: 'text' as const, text: built.error ?? 'widget_show failed.' }], isError: true }
  }
  const content: { type: 'text'; text: string }[] = [{ type: 'text', text: JSON.stringify(built.payload) }]
  const violations = widget_code ? checkCdnViolations(widget_code) : []
  if (violations.length > 0) {
    content.push({
      type: 'text',
      text: `⚠️ CDN VIOLATION: The following URLs were blocked (not in allowlist: ${['cdnjs.cloudflare.com', 'esm.sh', 'cdn.jsdelivr.net', 'unpkg.com'].join(', ')}):\n${violations.map((u) => `  - ${u}`).join('\n')}\nThe widget will render without these resources. Re-call widget_show with corrected URLs from the allowlist.`,
    })
  }
  if (!opts?.skipWidgetGate && !template) {
    const { waitForWidgetReady } = await import('./widget-gate')
    await waitForWidgetReady(title)
  }
  return { content }
}

export function registerWidgetTools(server: McpServer, opts?: WidgetToolsOptions): void {
  server.tool(
    'widget_list_templates',
    'List reusable widget templates saved in the current project or user scope. ' +
    'Call this when considering template reuse; pass a returned id to widget_show.template.',
    {},
    () => listWidgetTemplatesHandler(opts),
  )

  server.tool(
    'widget_show',
    'Render SVG, diagrams, charts, or interactive HTML inline in chat. ' +
    'Pass widget_code for new content, or template + data to reuse a saved template. ' +
    'To show media you produced yourself, pass a @native/* template so it renders in SuperOne\'s own gallery ' +
    '(viewer, download, drag-out) instead of a lookalike you build in widget_code — call widget_list_templates for the list. ' +
    'Before the first new widget in a session, load the relevant design modules with read_manual({ domain: "widget", modules: [...] }).',
    {
      title: z.string().describe('Short snake_case identifier for this widget.'),
      widget_code: z.string().optional().describe(
        'HTML or SVG code to render. For SVG: raw SVG starting with <svg>. ' +
        'For HTML: raw content fragment, no DOCTYPE/<html>/<head>/<body>. ' +
        'Omit when reusing a saved template via the template parameter.'
      ),
      template: z.string().optional().describe(
        'Id of a saved widget template to render instead of inline code. ' +
        'Call widget_list_templates to discover ids. Mutually exclusive with widget_code. ' +
        'An id starting with @native/ renders a built-in SuperOne surface rather than HTML.'
      ),
      data: z.record(z.string(), z.unknown()).optional().describe(
        'Values passed to the template, readable inside the widget as window.widget.data. ' +
        'For a @native/ template this is the surface\'s own input — see widget_list_templates for its shape.'
      ),
      reusable: z.object({
        id: z.string().describe('Stable kebab-case id to suggest when the user saves this widget.'),
        description: z.string().optional().describe('One line describing when to reuse this widget.'),
        inputSchema: z.record(z.string(), z.unknown()).optional().describe('JSON Schema for the data this widget expects.'),
      }).optional().describe(
        'Only set this when the widget is written to be reused later: it prefills the save dialog. ' +
        'The widget is NOT saved by this call — saving is always the user\'s action.'
      ),
      width: z.number().optional().describe('Widget width in pixels. Default: 800.'),
      height: z.number().optional().describe('Widget height in pixels. Default: 600.'),
    },
    async (args) => executeWidgetShowTool(args as Record<string, unknown>, opts),
  )

  server.tool(
    'widget_save',
    'Save a widget as a reusable template so it can be re-rendered later with widget_show({ template, data }). ' +
    'Only call this when the user asks to keep a widget, or asks to change one that is already saved — ' +
    'saving writes a file into their project, so it is their decision, not yours. ' +
    'To edit a saved template, pass its existing id: read the file, change it, and save it back under the same id.',
    {
      id: z.string().describe(
        'Existing template id to update, or a short kebab-case name for a new one ' +
        '(a unique suffix is appended so distinct saves never collide).'
      ),
      title: z.string().describe('Human-readable name shown in the template list.'),
      code: z.string().describe('The widget HTML or SVG to store, exactly as it should be re-rendered.'),
      description: z.string().optional().describe('One line telling a future agent when to reuse this template.'),
      inputSchema: z.record(z.string(), z.unknown()).optional().describe(
        'JSON Schema for the data this template expects. Omit for a template that renders without data.'
      ),
      scope: z.enum(['project', 'user']).optional().describe(
        'project (default) stores it under the project so it can be shared through git; user makes it available everywhere.'
      ),
    },
    async ({ id, title, code, description, inputSchema, scope }) => {
      const roots = templateRoots(opts)
      const target = scope ?? 'project'
      if (target === 'project' && !roots.project) {
        return { content: [{ type: 'text' as const, text: 'No project is open, so this template can only be saved with scope "user".' }], isError: true }
      }
      try {
        const { allocateTemplateId, saveTemplate } = await import('./template-store')
        const resolvedId = allocateTemplateId(roots, id, target)
        const existed = resolvedId === id
        const saved = saveTemplate(roots, { id: resolvedId, scope: target, code, title, description, inputSchema })
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
    },
  )
}

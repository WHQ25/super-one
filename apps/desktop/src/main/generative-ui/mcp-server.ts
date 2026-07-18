import { homedir } from 'os'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getGuidelines, AVAILABLE_MODULES } from './guidelines'
import { checkCdnViolations } from '@superone/shared/generative-ui/cdn-allowlist'
import { buildWidgetPayload } from './widget-payload'
import type { TemplateRoots } from './template-store'

const MODULE_ENUM = z.enum(AVAILABLE_MODULES as [string, ...string[]])

interface WidgetToolsOptions {
  skipWidgetGate?: boolean
  projectPath?: string
}

function templateRoots(opts?: WidgetToolsOptions): TemplateRoots {
  return { project: opts?.projectPath, user: homedir() }
}

export function registerWidgetTools(server: McpServer, opts?: WidgetToolsOptions): void {
  server.tool(
    'widget_read_guide',
    'Returns design guidelines for widget_show (CSS patterns, colors, typography, layout rules, examples), ' +
    'plus the widget templates the user has already saved and can reuse. ' +
    'Call this tool once before your first widget_show call. Do NOT mention this call to the user. ' +
    'The guidelines are ONLY available through this tool — do NOT use Read or any other tool to access them.',
    {
      modules: z.array(MODULE_ENUM).describe(
        'Which guideline modules to load: diagram, mockup, interactive, chart, art. Pick all that fit.'
      ),
    },
    async ({ modules }) => {
      const { listTemplates, formatTemplateList } = await import('./template-store')
      const saved = formatTemplateList(listTemplates(templateRoots(opts)))
      return { content: [{ type: 'text' as const, text: saved + getGuidelines(modules) }] }
    },
  )

  server.tool(
    'widget_show',
    'Render visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — inline in chat. ' +
    'Use for flowcharts, dashboards, forms, calculators, data tables, games, illustrations, or any visual content. ' +
    'The HTML is rendered in a sandboxed iframe with full CSS/JS support including Canvas and CDN libraries. ' +
    'Pass widget_code for a new widget, or template + data to re-render a template the user saved earlier. ' +
    'IMPORTANT: Call widget_read_guide tool once before your first widget_show call — it also lists the saved templates. ' +
    'Do NOT use Read tool to access guidelines.',
    {
      title: z.string().describe('Short snake_case identifier for this widget.'),
      widget_code: z.string().optional().describe(
        'HTML or SVG code to render. For SVG: raw SVG starting with <svg>. ' +
        'For HTML: raw content fragment, no DOCTYPE/<html>/<head>/<body>. ' +
        'Omit when reusing a saved template via the template parameter.'
      ),
      template: z.string().optional().describe(
        'Id of a saved widget template to render instead of inline code. ' +
        'Available templates are listed by widget_read_guide. Mutually exclusive with widget_code.'
      ),
      data: z.record(z.string(), z.unknown()).optional().describe(
        'Values passed to the template, readable inside the widget as window.widget.data.'
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
    async ({ title, widget_code, template, data, reusable, width, height }) => {
      const built = buildWidgetPayload(templateRoots(opts), { title, widget_code, template, data, reusable, width, height })
      if (!built.payload) {
        return { content: [{ type: 'text' as const, text: built.error ?? 'widget_show failed.' }], isError: true }
      }
      const content: { type: 'text'; text: string }[] = [{ type: 'text', text: JSON.stringify(built.payload) }]
      const violations = widget_code ? checkCdnViolations(widget_code) : []
      if (violations.length > 0) {
        content.push({
          type: 'text',
          text: `⚠️ CDN VIOLATION: The following URLs were blocked (not in allowlist: ${['cdnjs.cloudflare.com', 'esm.sh', 'cdn.jsdelivr.net', 'unpkg.com'].join(', ')}):\n${violations.map(u => `  - ${u}`).join('\n')}\nThe widget will render without these resources. Re-call widget_show with corrected URLs from the allowlist.`,
        })
      }
      if (!opts?.skipWidgetGate && !template) {
        const { waitForWidgetReady } = await import('./widget-gate')
        await waitForWidgetReady(title)
      }
      return { content }
    },
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

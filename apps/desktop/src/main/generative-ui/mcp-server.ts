import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { getGuidelines, AVAILABLE_MODULES } from './guidelines'
import { checkCdnViolations } from '@superone/shared/generative-ui/cdn-allowlist'
import { waitForWidgetReady } from './widget-gate'

const MODULE_ENUM = z.enum(AVAILABLE_MODULES as [string, ...string[]])

interface WidgetToolsOptions {
  skipWidgetGate?: boolean
}

export function registerWidgetTools(server: McpServer, opts?: WidgetToolsOptions): void {
  server.tool(
    'read_guidelines',
    'Returns design guidelines for show_widget (CSS patterns, colors, typography, layout rules, examples). ' +
    'Call this tool once before your first show_widget call. Do NOT mention this call to the user. ' +
    'The guidelines are ONLY available through this tool — do NOT use Read or any other tool to access them.',
    {
      modules: z.array(MODULE_ENUM).describe(
        'Which guideline modules to load: diagram, mockup, interactive, chart, art. Pick all that fit.'
      ),
    },
    async ({ modules }) => ({
      content: [{ type: 'text' as const, text: getGuidelines(modules) }],
    }),
  )

  server.tool(
    'show_widget',
    'Render visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — inline in chat. ' +
    'Use for flowcharts, dashboards, forms, calculators, data tables, games, illustrations, or any visual content. ' +
    'The HTML is rendered in a sandboxed iframe with full CSS/JS support including Canvas and CDN libraries. ' +
    'IMPORTANT: Call read_guidelines tool once before your first show_widget call. Do NOT use Read tool to access guidelines.',
    {
      title: z.string().describe('Short snake_case identifier for this widget.'),
      widget_code: z.string().describe(
        'HTML or SVG code to render. For SVG: raw SVG starting with <svg>. ' +
        'For HTML: raw content fragment, no DOCTYPE/<html>/<head>/<body>.'
      ),
      width: z.number().optional().describe('Widget width in pixels. Default: 800.'),
      height: z.number().optional().describe('Widget height in pixels. Default: 600.'),
    },
    async ({ title, widget_code, width, height }) => {
      const violations = checkCdnViolations(widget_code)
      const result = JSON.stringify({
        title,
        widget_code,
        width: width ?? 800,
        height: height ?? 600,
        isSVG: widget_code.trimStart().startsWith('<svg'),
      })
      const content: { type: 'text'; text: string }[] = [{ type: 'text', text: result }]
      if (violations.length > 0) {
        content.push({
          type: 'text',
          text: `⚠️ CDN VIOLATION: The following URLs were blocked (not in allowlist: ${['cdnjs.cloudflare.com', 'esm.sh', 'cdn.jsdelivr.net', 'unpkg.com'].join(', ')}):\n${violations.map(u => `  - ${u}`).join('\n')}\nThe widget will render without these resources. Re-call show_widget with corrected URLs from the allowlist.`,
        })
      }
      if (!opts?.skipWidgetGate) {
        await waitForWidgetReady(title)
      }
      return { content }
    },
  )
}

export function createGenerativeUiMcpServer(): McpSdkServerConfigWithInstance {
  const server = new McpServer({ name: 'widget', version: '1.0.0' })
  registerWidgetTools(server)
  return { type: 'sdk' as const, name: 'widget', instance: server } as unknown as McpSdkServerConfigWithInstance
}

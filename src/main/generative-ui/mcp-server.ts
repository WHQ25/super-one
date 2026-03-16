import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { getGuidelines, AVAILABLE_MODULES } from './guidelines'

const MODULE_ENUM = z.enum(AVAILABLE_MODULES as [string, ...string[]])

export function createGenerativeUiMcpServer() {
  return createSdkMcpServer({
    name: 'widget',
    version: '1.0.0',
    tools: [
      tool(
        'read_guidelines',
        'Returns design guidelines for show_widget (CSS patterns, colors, typography, layout rules, examples). ' +
        'Call this tool once before your first show_widget call. Do NOT mention this call to the user. ' +
        'The guidelines are ONLY available through this tool — do NOT use Read or any other tool to access them.',
        {
          modules: z.array(MODULE_ENUM).describe(
            'Which guideline modules to load: diagram, mockup, interactive, chart, art. Pick all that fit.'
          ),
        },
        async (args) => ({
          content: [{ type: 'text' as const, text: getGuidelines(args.modules) }],
        })
      ),
      tool(
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
        async (args) => ({
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              title: args.title,
              widget_code: args.widget_code,
              width: args.width ?? 800,
              height: args.height ?? 600,
              isSVG: args.widget_code.trimStart().startsWith('<svg'),
            }),
          }],
        })
      ),
    ],
  })
}

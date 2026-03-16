import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getGuidelines, AVAILABLE_MODULES } from './guidelines'

const server = new McpServer({ name: 'widget', version: '1.0.0' })

server.tool(
  'read_guidelines',
  'Returns design guidelines for show_widget. Call once before your first show_widget call.',
  {
    modules: z.array(z.enum(AVAILABLE_MODULES as [string, ...string[]])).describe(
      'Which guideline modules to load: diagram, mockup, interactive, chart, art.'
    ),
  },
  async ({ modules }) => ({
    content: [{ type: 'text' as const, text: getGuidelines(modules) }],
  })
)

server.tool(
  'show_widget',
  'Render visual content — SVG graphics, diagrams, charts, or interactive HTML widgets — inline in chat.',
  {
    title: z.string().describe('Short snake_case identifier for this widget.'),
    widget_code: z.string().describe('HTML or SVG code to render.'),
    width: z.number().optional().describe('Widget width in pixels. Default: 800.'),
    height: z.number().optional().describe('Widget height in pixels. Default: 600.'),
  },
  async ({ title, widget_code, width, height }) => ({
    content: [{
      type: 'text' as const,
      text: JSON.stringify({
        title,
        widget_code,
        width: width ?? 800,
        height: height ?? 600,
        isSVG: widget_code.trimStart().startsWith('<svg'),
      }),
    }],
  })
)

const transport = new StdioServerTransport()
server.connect(transport)

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import {
  browserActionSchema,
  executeBrowserAction,
  listBrowserActions,
  saveBrowserAction,
  summarizeBrowserAction,
} from '../browser/browser-actions'
import { browserErrorReply, browserTextReply, type BrowserToolReply } from './browser-mcp-replies'

export function registerBrowserActionTools(
  server: McpServer,
  sessionId: string,
  executeTool: (sessionId: string, tool: string, args: Record<string, unknown>) => Promise<BrowserToolReply>,
): void {
  server.registerTool(
    'browser_action_list',
    {
      description:
        'List saved semantic browser actions. Omit domain to list all actions, or pass a domain for an exact normalized-domain match. Returns compact summaries by default; set includeSteps:true before replacing an existing action when you need its complete definition.',
      inputSchema: {
        domain: z.string().optional().describe('Optional domain filter, e.g. github.com. Scheme, path, case, and a trailing dot are normalized away.'),
        includeSteps: z.boolean().default(false).describe('Include complete step definitions. Default false for a lean action catalog.'),
      },
    },
    async ({ domain, includeSteps }) => {
      try {
        const actions = listBrowserActions(domain)
        return browserTextReply({
          count: actions.length,
          actions: includeSteps ? actions : actions.map(summarizeBrowserAction),
        })
      } catch (err) {
        return browserErrorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_action_save',
    {
      description:
        'Create or replace a reusable semantic browser action. Actions are global across projects and sessions and are keyed by normalized domain + name. Steps run sequentially and support kind:"tool", "action", "set", "if", "forEach", and "repeat". Tool/action steps may saveAs a shared variable. Templates in tool args and nested action input may reference ${input.*}, ${vars.*}, ${result.*}, ${item.*}, and ${index}. Structured expressions use literal scalars, {kind:"literal",value}, {kind:"ref",path}, or {kind:"op",op,args}; arbitrary code is not executed. This tool does not record prior browser calls.',
      inputSchema: {
        domain: browserActionSchema.shape.domain,
        name: browserActionSchema.shape.name.describe('Stable lowercase action name using letters, numbers, underscores, or hyphens.'),
        description: browserActionSchema.shape.description.describe('Concise explanation of the action outcome and when to use it. Do not embed credentials or other secrets in steps; pass them as action inputs.'),
        parameters: browserActionSchema.shape.parameters.describe('Inputs accepted by browser_action_do. Values are referenced in steps as ${input.name}.'),
        steps: browserActionSchema.shape.steps.describe('Ordered flow steps. set writes to shared vars; if runs then or else; forEach exposes item and index; repeat exposes index. Loops allow at most 50 iterations, definitions at most 50 total steps, and execution at most 100 cumulative steps. Execution is fail-fast.'),
      },
    },
    async (args) => {
      try {
        const saved = saveBrowserAction(args)
        return browserTextReply({
          ok: true,
          created: saved.created,
          action: summarizeBrowserAction(saved.action),
        })
      } catch (err) {
        return browserErrorReply(err)
      }
    },
  )

  server.registerTool(
    'browser_action_do',
    {
      description:
        'Execute one saved semantic browser action, including flow control and nested actions. Call browser_action_list first when you do not know its parameters. Variables are shared across nested actions for the duration of this call. Execution is sequential and fail-fast, detects recursive action cycles, and returns the last primitive tool result plus the actual step count. The domain is a semantic namespace only and does not restrict navigation.',
      inputSchema: {
        domain: z.string().describe('Action domain namespace. Normalized before lookup.'),
        name: z.string().describe('Saved action name.'),
        input: z.record(z.string(), z.unknown()).default({}).describe('Values for the action parameters.'),
        tab: z.string().optional().describe('Browser view id inherited by tab-scoped primitive steps unless a step sets its own tab.'),
      },
    },
    async ({ domain, name, input, tab }) => {
      try {
        const result = await executeBrowserAction({
          domain,
          name,
          input,
          tab,
          executeTool: (tool, args) => executeTool(sessionId, tool, args),
        })
        const reply = browserTextReply(result)
        if (!result.ok) reply.isError = true
        return reply
      } catch (err) {
        return browserErrorReply(err)
      }
    },
  )
}

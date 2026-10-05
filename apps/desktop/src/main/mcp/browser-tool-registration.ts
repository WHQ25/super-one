import { z, toJSONSchema, type ZodTypeAny } from 'zod'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import { browserErrorReply, type BrowserToolReply } from './browser-mcp-replies'

export const BROWSER_DESCRIPTION_MAX_LENGTH = 160

export const browserDescriptionField = {
  description: z.string().trim().min(1).max(BROWSER_DESCRIPTION_MAX_LENGTH).describe(
    "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
  ),
}

export const browserTabField = {
  tab: z.string().optional().describe(
    'Browser view id, or a development mini-app view id: miniapp:<appId> for its panel, or one returned by miniapp_dev_preview or browser_tabs. Omit to target the focused browser view (errors if multiple are open).',
  ),
}

export type BrowserToolHandler = (args: Record<string, unknown>) => Promise<BrowserToolReply>

interface CapturingServer {
  registerTool: (
    name: string,
    config: { description: string; inputSchema?: Record<string, ZodTypeAny> },
    handler: BrowserToolHandler,
  ) => unknown
}

/** Capture the same registration used by the SDK for stdio descriptors/execution. */
export function makeBrowserCapturingServer(internal = false): {
  server: CapturingServer
  descriptors: SuperoneMcpToolDescriptor[]
  handlers: Map<string, BrowserToolHandler>
} {
  const descriptors: SuperoneMcpToolDescriptor[] = []
  const handlers = new Map<string, BrowserToolHandler>()
  const server: CapturingServer = {
    registerTool: (name, config, handler) => {
      const shape = config.inputSchema ?? {}
      const schema = z.object(shape)
      const { $schema: _schema, ...inputSchema } = toJSONSchema(schema)
      descriptors.push({ name, description: config.description, inputSchema })
      // Internal primitives serve a single agent-facing call and are not chat
      // rows. Saved action definitions also predate narration. Keep all effect
      // validation, including the persisted description on action_save.
      const executionSchema = internal && shape.description && name !== 'browser_action_save'
        ? schema.extend({ description: shape.description.optional() })
        : schema
      handlers.set(name, async (args) => {
        try {
          return await handler(executionSchema.parse(args ?? {}) as Record<string, unknown>)
        } catch (err) {
          return browserErrorReply(err)
        }
      })
      return { remove: () => {} }
    },
  }
  return { server, descriptors, handlers }
}

import { McpUiMessageRequestSchema } from '@modelcontextprotocol/ext-apps/app-bridge'
import { RequestSchema } from '@modelcontextprotocol/sdk/types.js'

/** ext-apps 1.7.5 omits request metadata. Preserve it before dispatching extensions. */
export const McpAppMessageRequestSchema = McpUiMessageRequestSchema.extend({
  params: McpUiMessageRequestSchema.shape.params.extend({ _meta: RequestSchema.shape.params.unwrap().shape._meta }),
})

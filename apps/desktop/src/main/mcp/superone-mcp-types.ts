export interface SuperoneMcpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP tool meta (e.g. `anthropic/alwaysLoad` so Claude Tool Search always exposes the tool). */
  _meta?: Record<string, unknown>
}

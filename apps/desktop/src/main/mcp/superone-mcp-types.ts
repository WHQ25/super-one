export interface SuperoneMcpToolIcon {
  src: string
  mimeType?: string
}

export interface SuperoneMcpToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** MCP 2025-11-25 tool icons; Grok forwards these on tools/list. */
  icons?: SuperoneMcpToolIcon[]
  /** MCP tool meta (e.g. `anthropic/alwaysLoad` so Claude Tool Search always exposes the tool). */
  _meta?: Record<string, unknown>
}

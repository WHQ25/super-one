import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerWidgetTools } from './mcp-server'

const server = new McpServer({ name: 'superone', version: '1.0.0' })
registerWidgetTools(server, { skipWidgetGate: true })

const transport = new StdioServerTransport()
server.connect(transport)

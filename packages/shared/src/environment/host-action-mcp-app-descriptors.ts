import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  MCP_APP_TOOLS_CALL_DESCRIPTION,
  MCP_APP_TOOLS_CALL_INPUT_DESCRIPTION,
  MCP_APP_TOOLS_CALL_SUMMARY_DESCRIPTION,
  MCP_APP_TOOLS_CALL_TOOL_DESCRIPTION,
  MCP_APP_TOOLS_CALL_VIEW_ID_DESCRIPTION,
  MCP_APP_TOOLS_LIST_DESCRIPTION,
  MCP_APP_TOOLS_LIST_INCLUDE_SCHEMA_DESCRIPTION,
  MCP_APP_TOOLS_LIST_VIEW_ID_DESCRIPTION,
} from '../superone-tool-descriptions'

export const MCP_APP_TOOLS_LIST_TOOL_NAME = 'mcp_app_tools_list' as const
export const MCP_APP_TOOLS_CALL_TOOL_NAME = 'mcp_app_tools_call' as const

export const HOST_ACTION_MCP_APP_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: MCP_APP_TOOLS_LIST_TOOL_NAME,
    description: MCP_APP_TOOLS_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        viewId: { type: 'string', description: MCP_APP_TOOLS_LIST_VIEW_ID_DESCRIPTION },
        includeSchema: { type: 'boolean', description: MCP_APP_TOOLS_LIST_INCLUDE_SCHEMA_DESCRIPTION },
      },
      additionalProperties: false,
    },
  },
  {
    name: MCP_APP_TOOLS_CALL_TOOL_NAME,
    description: MCP_APP_TOOLS_CALL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        viewId: { type: 'string', description: MCP_APP_TOOLS_CALL_VIEW_ID_DESCRIPTION },
        tool: { type: 'string', description: MCP_APP_TOOLS_CALL_TOOL_DESCRIPTION },
        input: { type: 'object', additionalProperties: true, description: MCP_APP_TOOLS_CALL_INPUT_DESCRIPTION },
        description: { type: 'string', description: MCP_APP_TOOLS_CALL_SUMMARY_DESCRIPTION },
      },
      required: ['viewId', 'tool'],
      additionalProperties: false,
    },
  },
]

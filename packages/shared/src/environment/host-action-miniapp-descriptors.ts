import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  MINIAPP_CALL_APP_ID_DESCRIPTION,
  MINIAPP_CALL_DESCRIPTION,
  MINIAPP_CALL_INPUT_DESCRIPTION,
  MINIAPP_CALL_TOOL_DESCRIPTION,
  MINIAPP_LIST_APP_ID_DESCRIPTION,
  MINIAPP_LIST_DESCRIPTION,
  MINIAPP_LIST_INCLUDE_SCHEMA_DESCRIPTION,
  MINIAPP_OPEN_APP_ID_DESCRIPTION,
  MINIAPP_OPEN_DESCRIPTION,
} from '../superone-tool-descriptions'

/** The fixed mini-app tools. Defined once: the desktop registrations reuse these descriptors. */
export const HOST_ACTION_MINIAPP_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    name: 'miniapp_list',
    description: MINIAPP_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: MINIAPP_LIST_APP_ID_DESCRIPTION },
        includeSchema: { type: 'boolean', description: MINIAPP_LIST_INCLUDE_SCHEMA_DESCRIPTION },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_call',
    description: MINIAPP_CALL_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: MINIAPP_CALL_APP_ID_DESCRIPTION },
        tool: { type: 'string', description: MINIAPP_CALL_TOOL_DESCRIPTION },
        input: { type: 'object', additionalProperties: true, description: MINIAPP_CALL_INPUT_DESCRIPTION },
      },
      required: ['appId', 'tool'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_open',
    description: MINIAPP_OPEN_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appId: { type: 'string', description: MINIAPP_OPEN_APP_ID_DESCRIPTION },
      },
      required: ['appId'],
      additionalProperties: false,
    },
  },
]

import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'

export const HOST_ACTION_MINIAPP_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "miniapp_list",
    "description": "List mini-apps authorized for this session and their tools. Omit appId for a compact catalog (tool names + one-line descriptions). Pass appId to inspect one app; includeSchema defaults true for that app's full tool definitions including inputSchema. Call this before miniapp_call when you do not know the tool names or parameters.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "appId": {
          "type": "string",
          "description": "Optional mini-app id. When set, returns that app's tools only."
        },
        "includeSchema": {
          "type": "boolean",
          "description": "When appId is set, include full tool definitions with inputSchema (default true). Ignored when listing all apps."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "miniapp_call",
    "description": "Execute a tool on a session-authorized mini-app. Pass appId + tool name from miniapp_list, and tool arguments as input. Panel open/close is implicit: non-standalone tools lazy-open the panel; standalone tools run without a panel. Do not invent tools \u2014 call miniapp_list first when unsure.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "appId": {
          "type": "string",
          "description": "Mini-app id (from miniapp_list or user @-mention)."
        },
        "tool": {
          "type": "string",
          "description": "Tool name declared by that app's manifest."
        },
        "input": {
          "type": "object",
          "additionalProperties": true,
          "description": "Arguments for the app tool. Validated against the tool's inputSchema at dispatch time."
        }
      },
      "required": [
        "appId",
        "tool"
      ],
      "additionalProperties": false
    }
  }
]

import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  SESSION_LIST_AGENTS_DESCRIPTION,
  SESSION_REQUEST_AGENTS_DESCRIPTION,
  LAUNCH_SUMMARY_DESCRIPTION,
  LAUNCH_TASK_DESCRIPTION,
  LAUNCH_MODE_DESCRIPTION,
  LAUNCH_SESSION_ID_DESCRIPTION,
  LAUNCH_PERMISSION_MODE_DESCRIPTION,
  LAUNCH_CWD_DESCRIPTION,
  LAUNCH_WORKTREE_DESCRIPTION,
  LAUNCH_BRANCH_NAME_DESCRIPTION,
  SESSION_START_DESCRIPTION,
  SESSION_SEND_DESCRIPTION,
  SESSION_RETRIEVE_DESCRIPTION
} from '../superone-tool-descriptions'

export const HOST_ACTION_COLLABORATION_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "session_collab_list_agents",
    "description": SESSION_LIST_AGENTS_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "session_collab_request",
    "description": SESSION_REQUEST_AGENTS_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "launches": {
          "type": "array",
          "minItems": 1,
          "maxItems": 16,
          "items": {
            "type": "object",
            "properties": {
              "launchId": {
                "type": "string",
                "description": "Optional caller correlation id."
              },
              "mode": {
                "type": "string",
                "enum": [
                  "spawn",
                  "handoff",
                  "link"
                ],
                "description": LAUNCH_MODE_DESCRIPTION
              },
              "sessionId": {
                "type": "string",
                "minLength": 1,
                "description": LAUNCH_SESSION_ID_DESCRIPTION
              },
              "agentId": {
                "type": "string",
                "description": "Agent profile id from session_collab_list_agents. Required for mode \"spawn\" and \"handoff\"; omit for \"link\"."
              },
              "summary": {
                "type": "string",
                "minLength": 1,
                "description": LAUNCH_SUMMARY_DESCRIPTION
              },
              "task": {
                "type": "string",
                "description": LAUNCH_TASK_DESCRIPTION
              },
              "name": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "description": "Spawn/handoff: human-friendly session label (e.g. \"Alice\"). Link: optional; defaults to peer session title."
              },
              "role": {
                "type": "string",
                "minLength": 1,
                "maxLength": 64,
                "description": "Spawn/handoff: role for title \"Name - Role\". Link: optional; defaults to \"Peer\"."
              },
              "config": {
                "type": "object",
                "description": "Spawn and handoff only. Ignored for mode \"link\".",
                "properties": {
                  "model": {
                    "type": "string"
                  },
                  "effort": {
                    "type": "string"
                  },
                  "fastMode": {
                    "type": "boolean",
                    "description": "Codex only. Enable the selected model's Fast service tier for this agent session."
                  },
                  "apiProviderId": {
                    "type": [
                      "string",
                      "null"
                    ]
                  },
                  "permissionMode": {
                    "type": "string",
                    "enum": [
                      "default",
                      "acceptEdits",
                      "bypassPermissions",
                      "plan",
                      "dontAsk",
                      "auto",
                      "agent"
                    ],
                    "description": LAUNCH_PERMISSION_MODE_DESCRIPTION
                  },
                  "sandboxMode": {
                    "type": "string",
                    "enum": [
                      "off",
                      "on",
                      "auto"
                    ]
                  },
                  "cwd": {
                    "type": "string",
                    "description": LAUNCH_CWD_DESCRIPTION
                  },
                  "worktree": {
                    "type": "object",
                    "description": LAUNCH_WORKTREE_DESCRIPTION,
                    "properties": {
                      "enabled": {
                        "type": "boolean"
                      },
                      "baseBranch": {
                        "type": "string"
                      },
                      "mode": {
                        "type": "string",
                        "enum": [
                          "branch",
                          "attach",
                          "detach"
                        ]
                      },
                      "branchName": {
                        "type": "string",
                        "description": LAUNCH_BRANCH_NAME_DESCRIPTION
                      },
                      "carryLocalChanges": {
                        "type": "boolean"
                      }
                    },
                    "required": [
                      "enabled",
                      "baseBranch",
                      "mode"
                    ],
                    "additionalProperties": false
                  },
                  "harnessConfig": {
                    "type": "object"
                  }
                },
                "additionalProperties": false
              }
            },
            "required": [
              "summary"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "launches"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_collab_start",
    "description": SESSION_START_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "credential": {
          "type": "string"
        }
      },
      "required": [
        "credential"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_collab_send",
    "description": SESSION_SEND_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "credential": {
          "type": "string"
        },
        "content": {
          "type": "string",
          "maxLength": 100000,
          "description": "Mailbox message body in Markdown. Prefer structured Markdown (headings, lists, code fences) for agent-to-agent handoffs; the SuperOne UI renders it as a Markdown preview."
        },
        "clientMessageId": {
          "type": "string"
        }
      },
      "required": [
        "credential",
        "content"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_collab_retrieve",
    "description": SESSION_RETRIEVE_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "credentials": {
          "type": "array",
          "minItems": 1,
          "maxItems": 32,
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "credentials"
      ],
      "additionalProperties": false
    }
  }
]

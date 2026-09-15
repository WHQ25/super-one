import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  AUTOMATION_LIST_DESCRIPTION,
  AUTOMATION_APPLY_DESCRIPTION,
  AUTOMATION_DELETE_DESCRIPTION
} from '../superone-tool-descriptions'

export const HOST_ACTION_AUTOMATION_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "automation_list",
    "description": AUTOMATION_LIST_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string",
          "description": "When set, return full detail for this automation (must belong to the current project)."
        },
        "enabled": {
          "type": "boolean",
          "description": "Filter by enabled state. Omit for all."
        },
        "query": {
          "type": "string",
          "description": "Case-insensitive name substring filter."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "description": "Max rows. Default 50, max 100."
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "description": "Pagination offset. Default 0."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "automation_apply",
    "description": AUTOMATION_APPLY_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "create",
            "update"
          ],
          "description": "create a new automation, or update an existing one (including toggle enabled)."
        },
        "id": {
          "type": "string",
          "description": "Required for update. Automation id from automation_list."
        },
        "name": {
          "type": "string",
          "description": "Display name. Required for create; optional for update."
        },
        "prompt": {
          "type": "string",
          "description": "Prompt sent to the agent when the automation runs. Required for create; optional for update."
        },
        "enabled": {
          "type": "boolean",
          "description": "Whether the scheduler will run this automation. Create defaults to true; use false to pause."
        },
        "schedule": {
          "type": "object",
          "description": "When to run. one-time needs runAt (ISO); recurring needs cron. Always include summary. Preset fields and examples: read_manual({ domain: \"product\", topic: \"automation\" }).",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "one-time",
                "recurring"
              ]
            },
            "cron": {
              "type": "string",
              "description": "Cron expression for recurring (required when type=recurring)."
            },
            "runAt": {
              "type": "string",
              "description": "ISO timestamp for one-time (required when type=one-time)."
            },
            "preset": {
              "type": "string",
              "enum": [
                "hourly",
                "daily",
                "weekly",
                "custom"
              ]
            },
            "timeOfDay": {
              "type": "string",
              "description": "HH:mm local time hint for daily/weekly presets."
            },
            "dayOfWeek": {
              "type": "array",
              "items": {
                "type": "integer",
                "minimum": 0,
                "maximum": 6
              },
              "description": "0=Sun … 6=Sat for weekly preset."
            },
            "minuteOfHour": {
              "type": "integer",
              "minimum": 0,
              "maximum": 59,
              "description": "Minute for hourly preset."
            },
            "summary": {
              "type": "string",
              "minLength": 1,
              "maxLength": 200,
              "description": "Natural-language schedule shown in the list and confirm dialog, in the user's language (e.g. \"Every weekday at 9:00 AM\"). Required for create."
            }
          },
          "required": [
            "type",
            "summary"
          ],
          "additionalProperties": false
        },
        "agentConfig": {
          "type": "object",
          "description": "Harness for the run; only type is required. Create defaults to claude + bypassPermissions. Field-by-field: read_manual({ domain: \"product\", topic: \"automation\" }).",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "claude",
                "codex",
                "acp",
                "opencode"
              ]
            },
            "agentName": {
              "type": "string",
              "description": "Claude only: named agent profile."
            },
            "model": {
              "type": "string"
            },
            "effort": {
              "type": "string",
              "description": "Unified effort (Claude levels, Codex reasoning, ACP mode ids)."
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
              "description": "Unified permission mode. Prefer bypassPermissions for unattended runs."
            },
            "sandboxMode": {
              "type": "string",
              "enum": [
                "off",
                "on",
                "auto"
              ],
              "description": "Claude sandbox (ignored by other harnesses)."
            },
            "apiProviderId": {
              "type": [
                "string",
                "null"
              ],
              "description": "Optional third-party AI provider credential id (claude/codex)."
            },
            "acpAgentId": {
              "type": "string",
              "description": "ACP only: agent id (e.g. grok-build)."
            },
            "reasoningEffort": {
              "type": "string",
              "enum": [
                "minimal",
                "low",
                "medium",
                "high",
                "xhigh",
                "max",
                "ultra"
              ],
              "description": "Codex legacy alias for effort."
            },
            "permissionPreset": {
              "type": "string",
              "enum": [
                "read-only",
                "default",
                "auto-review",
                "full-access"
              ],
              "description": "Codex legacy alias for permissionMode (full-access ≈ bypassPermissions)."
            }
          },
          "required": [
            "type"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "automation_delete",
    "description": AUTOMATION_DELETE_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "ids": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 20,
          "description": "Automation ids from automation_list to delete (current project only)."
        }
      },
      "required": ["ids"],
      "additionalProperties": false
    }
  }
]

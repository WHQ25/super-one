import type { HostActionSuperoneToolDescriptor } from './host-action-superone-descriptors'
import {
  MANUAL_READ_DESCRIPTION,
  SETUP_MINI_APP_DEV_DESCRIPTION,
  REGISTER_DEV_MINIAPP_DESCRIPTION,
  PACK_MINI_APP_DESCRIPTION,
  UPDATE_SUPERONE_TYPES_DESCRIPTION,
  CONFIG_READ_DESCRIPTION,
  CONFIG_APPLY_DESCRIPTION
} from '../superone-tool-descriptions'

export const HOST_ACTION_SETUP_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "read_manual",
    "description": MANUAL_READ_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "enum": [
            "product",
            "miniapp",
            "media",
            "widget"
          ],
          "description": "Manual domain. Omit to list all domains and their topics."
        },
        "topic": {
          "type": "string",
          "description": "Topic in the selected domain. Pass the domain alone to list valid topics."
        },
        "modules": {
          "type": "array",
          "minItems": 1,
          "maxItems": 6,
          "uniqueItems": true,
          "items": {
            "type": "string",
            "enum": [
              "diagram",
              "mockup",
              "interactive",
              "chart",
              "art",
              "native"
            ]
          },
          "description": "Widget only: one or more guideline modules. Mutually exclusive with topic."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "config_read",
    "description": CONFIG_READ_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "enum": [
            "general",
            "appearance",
            "browser",
            "computer-use",
            "agent-claude",
            "agent-codex",
            "ai-provider",
            "custom-platform"
          ],
          "description": "Which settings domain to read. Omit to list all domains with their descriptions."
        },
        "recordId": {
          "type": "string",
          "description": "Resource domains only: read one record's full current values instead of the record list."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "config_apply",
    "description": CONFIG_APPLY_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "changes": {
          "type": "array",
          "description": "Scalar settings changes to propose. Each item targets one field key from config_read. Mutually exclusive with `resource`.",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "description": "The settings field key, exactly as returned by config_read."
              },
              "value": {
                "type": [
                  "string",
                  "number",
                  "boolean",
                  "null"
                ],
                "description": "The new value. Use null (or \"\") to reset a clearable field to its default."
              }
            },
            "required": [
              "key",
              "value"
            ],
            "additionalProperties": false
          }
        },
        "resource": {
          "type": "object",
          "description": "A resource create/update/delete to propose, e.g. resource:\"ai-provider\". Mutually exclusive with `changes`.",
          "properties": {
            "resource": {
              "type": "string",
              "description": "The resource domain, e.g. \"ai-provider\" \u2014 as returned by config_read."
            },
            "operation": {
              "type": "string",
              "enum": [
                "create",
                "update",
                "delete"
              ],
              "description": "Which operation to perform."
            },
            "recordId": {
              "type": "string",
              "description": "The record's `id` (from config_read). Required for update/delete."
            },
            "values": {
              "type": "object",
              "description": "Field values keyed by field key, using the field keys/types from config_read. Required for create (all required fields) and update (only the fields being changed)."
            }
          },
          "required": [
            "resource",
            "operation"
          ],
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "miniapp_dev_setup",
    "description": SETUP_MINI_APP_DEV_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "description": "Display name for the mini-app"
        },
        "slug": {
          "type": "string",
          "description": "URL-safe lowercase identifier (e.g. \"weather-app\"). Used to build the appId. Must be lowercase alphanumeric with hyphens."
        },
        "directory": {
          "type": "string",
          "description": "Absolute path to the directory where the mini-app source will be scaffolded. For scope=\"project\", this MUST be inside projectDir (e.g. <projectDir>/packages/my-app or <projectDir>/tools/dashboard). For scope=\"user\", anywhere on disk (e.g. ~/code/my-tool)."
        },
        "scope": {
          "type": "string",
          "enum": [
            "project",
            "user"
          ],
          "description": "project (default): app visible only in the given project; .s1-dev.json is committable. user: app visible across every project on this machine."
        },
        "projectDir": {
          "type": "string",
          "description": "Absolute path to the project directory. Required when scope=\"project\"."
        },
        "template": {
          "type": "string",
          "enum": [
            "vanilla",
            "react"
          ],
          "description": "vanilla (default): single index.html, no build needed. react: React + TypeScript + Tailwind, requires `bun run build` after scaffold."
        },
        "description": {
          "type": "string",
          "description": "Short description of what the app does"
        }
      },
      "required": [
        "name",
        "slug",
        "directory"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "miniapp_dev_register",
    "description": REGISTER_DEV_MINIAPP_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "directory": {
          "type": "string",
          "description": "Absolute path to the existing mini-app source directory. Must contain a manifest.json at the root or under dist/."
        },
        "installScope": {
          "type": "string",
          "enum": [
            "user",
            "project",
            "none"
          ],
          "description": "Where to immediately install a dev pointer after registering. \"none\" (default) just registers; user can install later via Settings \u2192 Apps \u2192 Library."
        },
        "projectDir": {
          "type": "string",
          "description": "Required when installScope=\"project\"."
        },
        "force": {
          "type": "boolean",
          "description": "Overwrite an existing prod install in the chosen scope. Default false."
        },
        "name": {
          "type": "string",
          "description": "Override the display name used in the dev-registry. Defaults to manifest.name."
        }
      },
      "required": [
        "directory"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "miniapp_dev_pack",
    "description": PACK_MINI_APP_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "appDir": {
          "type": "string",
          "description": "Absolute path to the mini-app directory containing manifest.json"
        },
        "outputDir": {
          "type": "string",
          "description": "Absolute path to the directory where the .s1app file will be written"
        }
      },
      "required": [
        "appDir",
        "outputDir"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "miniapp_dev_update_types",
    "description": UPDATE_SUPERONE_TYPES_DESCRIPTION,
    "inputSchema": {
      "type": "object",
      "properties": {
        "appDir": {
          "type": "string",
          "description": "Absolute path to the mini-app directory"
        }
      },
      "required": [
        "appDir"
      ],
      "additionalProperties": false
    }
  }
]

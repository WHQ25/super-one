/** Auto-generated SuperOne MCP tool descriptors for Host Action discovery.\n * Combined from desktop listSuperoneMcpTools + computer use + widgets + mobile share.\n * Regenerate when SuperOne MCP tool surface changes.\n */
export interface HostActionSuperoneToolDescriptor {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  /** Optional MCP tool meta (e.g. anthropic/alwaysLoad). */
  _meta?: Record<string, unknown>
}

const deviceDescriptionProperty = {
  type: "string",
  minLength: 1,
  maxLength: 160,
  description: "A short human-friendly explanation of what this step accomplishes, phrased for the user watching (e.g. 'Open the profile tab', 'Check the order total'). Shown in the UI in place of refs and coordinates. Write it in the conversation's language."
}

const deviceTargetProperty = {
  type: "string",
  description: "Which controlled device to act on — the id from device_list, or its name. Optional while this session controls exactly one device; required once it controls more than one (driving the wrong app there looks like a bug in the right one). Use device_request_control to be granted another."
}

const deviceConditionSchema = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["exists", "notExists", "textEquals", "textContains"] },
    ref: {
      description: "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
      type: "string"
    },
    label: { description: "Visible name of the element.", type: "string" },
    identifier: {
      description: "Developer-assigned id. Survives copy changes and translation — the most durable target.",
      type: "string"
    },
    text: {
      description: "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
      type: "string",
      minLength: 1
    }
  },
  required: ["kind"],
  additionalProperties: false
}

const deviceActionSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      enum: ["tap", "doubleTap", "longPress", "swipe", "pinch", "press", "type", "key", "rotate", "keyboard"]
    },
    ref: { description: "Element ref from the snapshot, e.g. \"@e12\". Preferred over coordinates.", type: "string" },
    x: {
      description: "Horizontal position as a fraction of the screen (0-1). Only when no ref fits.",
      type: "number",
      minimum: 0,
      maximum: 1
    },
    y: {
      description: "Vertical position as a fraction of the screen (0-1).",
      type: "number",
      minimum: 0,
      maximum: 1
    },
    direction: {
      description: "swipe: which way the finger travels. Content moves the opposite way, so \"up\" scrolls down a list.",
      type: "string",
      enum: ["up", "down", "left", "right"]
    },
    distance: {
      description: "swipe: travel as a fraction of the screen. Default 0.6.",
      type: "number",
      minimum: 0.05,
      maximum: 1
    },
    toX: {
      description: "swipe: explicit destination instead of direction.",
      type: "number",
      minimum: 0,
      maximum: 1
    },
    toY: { type: "number", minimum: 0, maximum: 1 },
    scale: {
      description: "pinch: final separation factor. Below 1 pinches in (zoom out), above 1 spreads.",
      type: "number",
      minimum: 0.1,
      maximum: 5
    },
    durationMs: {
      description: "How long the gesture takes. Short swipes flick and coast; long ones drag and stop.",
      type: "integer",
      minimum: 16,
      maximum: 10000
    },
    text: {
      description: "type: text to enter. Anything the simulated keyboard cannot spell (Chinese, emoji) is pasted automatically.",
      type: "string"
    },
    button: {
      type: "string",
      enum: ["home", "lock", "side", "volume-up", "volume-down", "back", "app-switch"],
      description: "key: a hardware button. `back` and `app-switch` are Android-only and are refused elsewhere.",
    },
    orientation: {
      type: "string",
      enum: ["portrait", "landscape-left", "portrait-upside-down", "landscape-right"]
    },
    connected: {
      description: "keyboard: attach or detach the hardware keyboard. Detach it to make the on-screen keyboard appear.",
      type: "boolean"
    }
  },
  required: ["type"],
  additionalProperties: false
}

export const HOST_ACTION_SUPERONE_TOOL_DESCRIPTORS: HostActionSuperoneToolDescriptor[] = [
  {
    "name": "session_collab_list_agents",
    "description": "List the agent profiles available for user-approved child sessions. Only launchable agents are returned. Inspect each profile's harness and defaultConfig before session_collab_request. You may reuse one agentId for multiple launches. Skip this call when the user already named an agent with @ — that mention carries its agentId.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "session_collab_request",
    "description": "Request user approval for collaboration launches. See the mode field for spawn vs handoff vs link. Spawn/handoff: pick an agentId from session_collab_list_agents; require name, role, summary, task. Link: require sessionId + summary. Read read_manual({ domain: \"product\", topic: \"collaboration\" }) before the first launch in a session. User must approve; returns the credential for session_collab_start.",
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
                "description": "\"spawn\" (default) = nested child with a two-way mailbox. \"handoff\" = top-level sibling, not nested: it owns the task from then on, with no mailbox and no reply — pass work forward rather than supervise it. \"link\" = connect to an existing session (sessionId required)."
              },
              "sessionId": {
                "type": "string",
                "minLength": 1,
                "description": "Existing SuperOne session id to link with (mode \"link\" only). Required for link; ignore for spawn. Prefer ids from @session mentions or session_list — never invent ids."
              },
              "agentId": {
                "type": "string",
                "description": "Agent profile id from session_collab_list_agents. Required for mode \"spawn\" and \"handoff\"; omit for \"link\"."
              },
              "summary": {
                "type": "string",
                "minLength": 1,
                "description": "Short 2–3 sentence task summary shown collapsed in the confirm dialog. Not the full brief — put detail in task."
              },
              "task": {
                "type": "string",
                "description": "Full Markdown brief. Spawn/handoff: delivered to the new session on session_collab_start. A handoff receiver cannot ask you anything back, so make the brief self-contained. Link: optional opening for the peer (mailbox + turn wake, never system prompt). Expandable in the confirm UI."
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
                    "description": "How autonomous the child session is. Nobody watches a child, so prefer the most autonomous mode it can finish under; \"plan\"/\"default\" only when stopping for human review is the point. Per-harness mode names, and why requesting autonomy is safe here: See read_manual({ domain: \"product\", topic: \"collaboration\" })."
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
                    "description": "Only for a genuinely different project root; omit for the current project. Never a same-repo worktree leaf — express isolation with config.worktree. See read_manual({ domain: \"product\", topic: \"collaboration\" })."
                  },
                  "worktree": {
                    "type": "object",
                    "description": "Host-managed worktree for same-repo isolation; leave cwd unset. For parallel implementers, not for read-only review of the shared checkout. See read_manual({ domain: \"product\", topic: \"collaboration\" }).",
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
                        "description": "With mode \"branch\", create this unique branch. Git cannot check out one branch in two worktrees."
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
    "description": "Activate one approved collaboration credential. Spawn: create the child and deliver its task. Handoff: create the sibling session and deliver the task; the credential is spent, no mailbox follows. Link: bind the existing peer and wake it via turn injection (not system prompt). Returns when the peer begins or is notified. Retries are idempotent. Start all credentials back-to-back.",
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
    "description": "Send a persistent Markdown message through one collaboration mailbox (spawn parent-child or link peers). Use clientMessageId for retry-safe delivery. The host wakes the peer and later wakes you when it replies. After sending, continue other work or end your turn. Never sleep, resend, or poll session_collab_retrieve while waiting.",
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
    "description": "Retrieve queued Markdown messages for this session from one or more collaboration mailboxes. Call after a collaboration wake, or once before acting on peer input. This is a non-blocking read: status \"empty\" is not a retry signal. Do not sleep or poll; end your turn and wait for the next wake.",
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
  },
  {
    "name": "read_manual",
    "description": "Read bundled SuperOne manuals. Omit domain to list all domains; pass domain to list its topics; pass domain with topic to read one topic. For widget, pass either topic or modules, never both. Read product/collaboration before session_collab_request, product/automation before automation_apply, product/devices before device_request_control, product/browser before saving a browser action, miniapp/overview before mini-app development, and media/overview before provider-specific options. Use config_read for live settings and widget_list_templates for saved widgets.",
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
    "description": "Read live SuperOne settings and their field schema. Always call this before config_apply. Omit domain to list settings and resource domains; pass domain to read exact keys, current values, and constraints. For resource domains, pass recordId to read one record before updating or deleting it. Use read_manual for documentation.",
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
    "description": "Propose a settings change or resource create/update/delete using keys returned by config_read. Pass exactly one of changes or resource. Every call opens an editable confirmation dialog and applies nothing without user approval. For updates, send only changed fields. Stop on cancelled or error; on rejected, use the returned feedback before retrying.",
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
    "description": "Scaffold and register a new mini-app after reading miniapp/overview and confirming its requirements, template, tools, directory, and scope with the user. The tool creates source files, updates ~/.superone/dev-registry.json, and writes a project- or user-scoped .s1-dev.json pointer. Use miniapp_dev_register instead when source files already exist.",
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
    "description": "Register an existing mini-app directory without modifying its source files. Reads manifest.json from the directory or dist, updates ~/.superone/dev-registry.json, and optionally writes a project- or user-scoped .s1-dev.json pointer.",
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
    "description": "Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.",
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
    "description": "Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.",
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
  },
  {
    "name": "session_rename",
    "description": "Rename the current chat session to a concise topic label shown in the sidebar. Always pass tags (set): 1–4 short kebab-case labels you choose so session_list/session_search can find this chat. Reuse names from session_tag_list when they fit; invent one when they don't. Top-level agent only — a Task/subagent worker does not own the user-facing title and must not call it.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "A concise 4-8 word title describing the current conversation topic.",
          "minLength": 1,
          "maxLength": 80
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8,
          "description": "Replace this session's tags (set). Pass 1–4 short kebab-case labels you choose. Reuse names from session_tag_list when they fit; invent when they don't. Empty array clears. Applied even when the title is user_locked."
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_tag",
    "description": "Tag SuperOne sessions so session_list/session_search can filter by tag. Default: current session. Pass sessionId for one other session, or sessionIds with add to tag many. Use add, remove, or set (exactly one). set: [] clears. Pick 1–4 short kebab-case labels; reuse names from session_tag_list when they fit, otherwise invent. Only the top-level agent may call this; subagents must not. Not session_rename (titles) and not live collab.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "description": "One session to tag. Default: current. Mutually exclusive with sessionIds."
        },
        "sessionIds": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 50,
          "description": "Bulk target ids (max 50). add required; set/remove not allowed. Mutually exclusive with sessionId."
        },
        "add": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Tags to add (normalized, de-duped). Mutually exclusive with remove/set."
        },
        "remove": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Tags to remove. Mutually exclusive with add/set."
        },
        "set": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Replace all tags. Empty array clears. Mutually exclusive with add/remove."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "session_tag_list",
    "description": "List tags used on SuperOne sessions (tag + session count). Default: current project; projectId or allProjects for other scope. Filter with query (tag substring). Hidden sessions omitted unless includeHidden. Call this before session_list/session_search with tags. Then filter with tags + tagMatch any (at least one) or all (every tag). Not live collab.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive substring filter on tag name."
        },
        "includeHidden": {
          "type": "boolean",
          "description": "Count hidden sessions. Default false."
        },
        "projectId": {
          "type": "string",
          "description": "List tags in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "List tags across every SuperOne project. Mutually exclusive with projectId. Default false."
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
    "name": "project_list",
    "description": "List SuperOne projects (id, name, path, lastActiveAt). Call this to discover projectId before session_list/session_search with projectId. Default order is last-active desc. Filter with query (name/path substring). isCurrent marks the project of the calling session.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive substring filter on project name or path."
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
    "name": "session_list",
    "description": "List SuperOne sessions (metadata only). Default: current project. Pass projectId (from project_list) or allProjects=true. Rows include projectId only — use project_list for path/name. Filter by title query, harness, pin/hidden, dates or tags (discover them with session_tag_list). Use before session_read/session_search. Not live collab or harness resume.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "description": "Case-insensitive title substring filter."
        },
        "harness": {
          "type": "string",
          "enum": [
            "claude",
            "codex",
            "acp",
            "opencode"
          ],
          "description": "Filter by harness."
        },
        "includeHidden": {
          "type": "boolean",
          "description": "Include hidden sessions. Default false."
        },
        "includePinnedOnly": {
          "type": "boolean",
          "description": "Only pinned sessions. Default false."
        },
        "parentOnly": {
          "type": "boolean",
          "description": "Exclude collab child sessions. Default false."
        },
        "olderThan": {
          "type": "string",
          "description": "ISO timestamp — only sessions last active before this."
        },
        "newerThan": {
          "type": "string",
          "description": "ISO timestamp — only sessions last active after this."
        },
        "tags": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 8,
          "description": "Tags from session_tag_list. Filter sessions that have these labels."
        },
        "tagMatch": {
          "type": "string",
          "enum": [
            "any",
            "all"
          ],
          "description": "any = at least one listed tag (default). all = every listed tag. Ignored when tags is omitted."
        },
        "projectId": {
          "type": "string",
          "description": "List sessions in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "List sessions across every SuperOne project. Mutually exclusive with projectId. Default false."
        },
        "order": {
          "type": "string",
          "enum": [
            "last_active_desc",
            "last_active_asc",
            "created_desc",
            "created_asc",
            "message_count_desc",
            "message_count_asc",
            "size_desc",
            "size_asc"
          ],
          "description": "Sort order. Default last_active_desc. last_active_asc = oldest first. created_* by createdAt; message_count_* by message count; size_* ranks by approx transcript size and includes sizeBytes (character length of message JSON, not disk page-file bytes)."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max rows. Default 20, max 50."
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
    "name": "session_search",
    "description": "Search SuperOne chat transcripts by text (title + message body). Default: current project; projectId or allProjects for cross-project. Optional tags + tagMatch (any/all, default any) narrows sessions in SQL before scanning messages. Discover tags with session_tag_list. Returns matching message hits with short snippets and projectId. Then call session_read with sessionId/messageId. Snippets are pointers only — not full bodies.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "description": "Search terms (AND). Matches title and message text."
        },
        "harness": {
          "type": "string",
          "enum": [
            "claude",
            "codex",
            "acp",
            "opencode"
          ]
        },
        "sessionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "maxItems": 32,
          "description": "Optional: restrict search to these session ids."
        },
        "role": {
          "type": "string",
          "enum": [
            "user",
            "assistant",
            "any"
          ],
          "description": "Message role filter. Default any."
        },
        "tags": {
          "type": "array",
          "items": { "type": "string" },
          "maxItems": 8,
          "description": "Tags from session_tag_list. Filter sessions that have these labels."
        },
        "tagMatch": {
          "type": "string",
          "enum": ["any", "all"],
          "description": "any = at least one listed tag (default). all = every listed tag. Ignored when tags is omitted."
        },
        "projectId": {
          "type": "string",
          "description": "Search this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project."
        },
        "allProjects": {
          "type": "boolean",
          "description": "Search every SuperOne project. Mutually exclusive with projectId. Default false."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max hits. Default 20, max 50."
        }
      },
      "required": [
        "query"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_read",
    "description": "Read another SuperOne session's saved transcript by id (any project; harness-agnostic; does not resume provider threads). Do not read the current session — it is already in your context. Views: meta | user | assistant | text | tools | tool_detail. user/assistant/text are pure conversation (no tool lines; assistant/text include toolCount). tools = index; tool_detail needs toolUseId. Paginate with limit/cursor; anchor with messageId/around. Prefer user then on-demand assistant/tools. meta includes projectId and tags.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "sessionId": {
          "type": "string",
          "minLength": 1,
          "description": "Target SuperOne session id from session_list or session_search (any project). Do not pass the current session."
        },
        "view": {
          "type": "string",
          "enum": [
            "meta",
            "user",
            "assistant",
            "text",
            "tools",
            "tool_detail"
          ],
          "description": "meta=metadata; user=user text only; assistant=assistant text + toolCount; text=both; tools=tool index; tool_detail=one tool (needs toolUseId). Default text."
        },
        "messageId": {
          "type": "string",
          "description": "Anchor page at this message id (from search or a prior read)."
        },
        "around": {
          "type": "integer",
          "minimum": 0,
          "maximum": 50,
          "description": "With messageId: include this many messages before and after on the global timeline."
        },
        "cursor": {
          "type": [
            "integer",
            "null"
          ],
          "description": "Exclusive end index for the next older page (from a prior read). Omit for newest page."
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Max messages this page. Default 20, max 50."
        },
        "includeThinking": {
          "type": "boolean",
          "description": "Include thinking blocks in text views. Default false."
        },
        "toolUseId": {
          "type": "string",
          "description": "Required for view=tool_detail."
        }
      },
      "required": [
        "sessionId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "session_cleanup",
    "description": "Hide, unhide, or delete SuperOne sessions by id (from session_list; ids may be from any project). hide/unhide need no confirmation. delete always opens a user confirmation dialog. Never deletes the current session; skips pinned unless includePinned. Prefer session_list to choose ids first.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "hide",
            "unhide",
            "delete"
          ],
          "description": "hide/unhide soft-archive (no confirm). delete permanently removes after user approval dialog."
        },
        "sessionIds": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "minItems": 1,
          "maxItems": 50,
          "description": "Session ids from session_list to act on."
        },
        "includePinned": {
          "type": "boolean",
          "description": "Allow acting on pinned sessions. Default false (pinned are skipped)."
        },
        "maxDelete": {
          "type": "integer",
          "minimum": 1,
          "maximum": 50,
          "description": "Hard cap on sessions acted on. Default 50."
        }
      },
      "required": [
        "action",
        "sessionIds"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "media_list_providers",
    "description": "List configured media providers that have usable credentials. Filter by image or video. Use a returned provider id with media_generate_image or media_generate_video; use kind to select the matching media manual topic. Honor returned sizing and sizeNote constraints.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "category": {
          "type": "string",
          "enum": [
            "image",
            "video"
          ],
          "description": "Filter by media category. Omit to list all usable providers."
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "media_generate_image",
    "description": "Generate or edit an image. For edits, pass source files in reference_image_paths. The result is displayed automatically; do not embed it again. Inspect previewPaths only, because savedPaths contains full-resolution originals for export or follow-up edits. Before provider-specific options, call media_list_providers and read media/overview plus the matching provider topic. Check result warnings for ignored options.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "A detailed description of the image to generate, or the edit to apply when reference images are provided."
        },
        "provider": {
          "type": "string",
          "description": "Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider."
        },
        "model": {
          "type": "string",
          "description": "Model id override. Defaults to the provider's default model."
        },
        "aspect_ratio": {
          "type": "string",
          "description": "Aspect ratio like \"16:9\" or \"1:1\". Preferred for google models."
        },
        "size": {
          "type": "string",
          "description": "Size for the image. OpenAI: pixel size like \"1024x1024\". Ark: \"2K\"/\"4K\" or \"WxH\". Google Gemini image models: resolution tier \"1K\"/\"2K\"/\"4K\" (or \"512\"); pair with aspect_ratio. Check media_list_providers sizeNote."
        },
        "reference_image_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image."
        }
      },
      "required": [
        "prompt"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "media_generate_video",
    "description": "Submit an asynchronous video generation after the user reviews its parameters. Stop on cancelled or error; use feedback before retrying. Poll media_video_status about every 30s until generated or error. The finished video is displayed automatically — do not embed it again. For provider options call media_list_providers(category:\"video\"), then read media/overview and the matching provider topic.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "prompt": {
          "type": "string",
          "description": "A detailed description of the video to generate, including motion and camera direction."
        },
        "provider": {
          "type": "string",
          "description": "Which configured video provider id to use. Call media_list_providers with category \"video\" to discover ids. Defaults to the first usable provider."
        },
        "model": {
          "type": "string",
          "description": "Model id override. Defaults to the provider's default video model."
        },
        "first_frame_path": {
          "type": "string",
          "description": "Absolute path to an image to animate from (image-to-video). This is the starting frame."
        },
        "last_frame_path": {
          "type": "string",
          "description": "Absolute path to an image the video should end on. Requires first_frame_path."
        },
        "reference_image_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference images for character or scene consistency. Up to 9 images total across all roles on Ark."
        },
        "reference_video_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference video clips. Volcengine Ark (Seedance) only; ignored by other providers."
        },
        "reference_audio_paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths to reference audio tracks. Volcengine Ark (Seedance) only; ignored by other providers."
        },
        "aspect_ratio": {
          "type": "string",
          "description": "Aspect ratio like \"16:9\", \"9:16\" or \"1:1\"."
        },
        "resolution": {
          "type": "string",
          "description": "Pixel resolution like \"1920x1080\" or \"1280x720\". Ark maps this onto its 480p/720p/1080p tiers; Sora accepts only 720x1280, 1280x720, 1024x1792, 1792x1024."
        },
        "duration": {
          "type": "number",
          "description": "Clip length in seconds. Ark accepts 2-15; Sora accepts only 4, 8 or 12."
        },
        "fps": {
          "type": "number",
          "description": "Frames per second, e.g. 24. Ignored by providers that derive it from the model."
        },
        "seed": {
          "type": "number",
          "description": "Seed for reproducible generation."
        },
        "generate_audio": {
          "type": "boolean",
          "description": "Whether the model should generate a soundtrack alongside the video, where supported."
        },
        "watermark": {
          "type": "boolean",
          "description": "Whether to stamp the provider watermark. Volcengine Ark only."
        },
        "camera_fixed": {
          "type": "boolean",
          "description": "Lock the camera in place instead of letting the model move it. Volcengine Ark only."
        }
      },
      "required": [
        "prompt"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "media_video_status",
    "description": "Check on a video generation started by media_generate_video. Returns `{status:\"running\"}` while it renders, `{status:\"generated\", savedPaths:[...]}` when finished, or `{status:\"error\", message}` if it failed. Each call asks the provider directly and is what advances the job, so polling is required rather than cosmetic: without it the video is never downloaded or saved. Poll roughly every 30 seconds while it is running. Do not tell the user the video is ready until this returns `generated`.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "generation_id": {
          "type": "string",
          "description": "The generationId returned by media_generate_video."
        }
      },
      "required": [
        "generation_id"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_tools_list",
    "description": "List WebMCP tools registered by the current secure page. Use this to discover page-provided actions and their input schemas, then call browser_tools_call with a returned name.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_tools_call",
    "description": "Call one WebMCP tool registered by the current secure page. Use browser_tools_list first to get the tool name and input schema. The page is untrusted and the user may need to approve the call.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this page tool call accomplishes, phrased for the end user watching (e.g. 'Add the shirt to the cart', 'Submit the quote request'). Shown in the UI next to the tool name. Write it in the conversation's language.",
          "type": "string"
        },
        "name": {
          "description": "Tool name from browser_tools_list. Required.",
          "type": "string"
        },
        "input": {
          "default": {},
          "description": "Arguments; validated against the page-declared inputSchema at dispatch time.",
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        }
      },
      "required": [
        "input"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_snapshot",
    "description": "Inspect the current page. `include` picks sections: meta, elements (flat interactive + CSS selectors), tree (structure), text, console, screenshot. Default [meta, elements, console] (lean). include:[console] skips the DOM scan. include:[screenshot] saves a PNG and returns path — image is NOT loaded; Read the path if pixels matter. Result is TOON unless a screenshot is requested with other sections (then JSON {screenshot, page}). Prefer this before browser_act. Use browser_query when you already know the target.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "include": {
          "description": "Which sections to return. Default ['meta','elements','console'].",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "meta",
              "elements",
              "tree",
              "text",
              "console",
              "screenshot"
            ]
          }
        },
        "filter": {
          "type": "string"
        },
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        },
        "depth": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "treeMax": {
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "textMaxChars": {
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        },
        "selector": {
          "description": "Element to screenshot when include contains screenshot.",
          "type": "string"
        },
        "console": {
          "type": "object",
          "properties": {
            "level": {
              "type": "array",
              "items": {
                "type": "string",
                "enum": [
                  "log",
                  "info",
                  "warning",
                  "error"
                ]
              }
            },
            "grep": {
              "type": "string"
            },
            "regex": {
              "type": "boolean"
            },
            "ignoreCase": {
              "type": "boolean"
            },
            "invert": {
              "type": "boolean"
            },
            "max": {
              "type": "integer",
              "minimum": 1,
              "maximum": 200
            }
          },
          "additionalProperties": false
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_query",
    "description": "Find or inspect elements. op=search (default) matches role / text / css / attributes and returns a TOON table of reusable selectors. op=inspect returns detail on one selector (fields: text, html, attributes, value, box, styles, context). Use this instead of snapshot when you already know what you are looking for. Do not use this to click or type (browser_act).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "op": {
          "description": "Default search.",
          "type": "string",
          "enum": [
            "search",
            "inspect"
          ]
        },
        "role": {
          "type": "string"
        },
        "text": {
          "type": "string"
        },
        "selector": {
          "description": "CSS selector. Required for inspect.",
          "type": "string"
        },
        "attributes": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "visible": {
          "type": "boolean"
        },
        "max": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "fields": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "text",
              "html",
              "attributes",
              "value",
              "box",
              "styles",
              "context"
            ]
          }
        },
        "maxChars": {
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_wait_for",
    "description": "Block until the page reaches a desired state. Provide at least one condition; all are AND-combined: a css selector that must be visible, a selector that must be gone, a visible-text substring, and/or a URL substring. Use after browser_act or browser_tabs navigate when the page changes asynchronously. Defaults to 15s, max 60s. Do not sleep+poll with snapshot yourself.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector that must be present and visible.",
          "type": "string"
        },
        "selectorGone": {
          "description": "CSS selector that must be absent or hidden.",
          "type": "string"
        },
        "text": {
          "description": "Substring that must appear in visible document text.",
          "type": "string"
        },
        "urlIncludes": {
          "description": "Substring that must appear in the current URL.",
          "type": "string"
        },
        "timeoutMs": {
          "description": "Maximum wait in milliseconds. Default 15000, max 60000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_evaluate",
    "description": "Evaluate a JavaScript expression in the page and return its serializable result. Prefer snapshot and browser_act; use evaluate only for inspection or interactions those tools cannot express. The expression may mutate page state. A returned Promise is awaited. A large result (>32KB) is spilled to a file as { spilled:true, path, bytes, preview }.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "expression": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64000,
          "description": "JavaScript expression to evaluate in the page."
        }
      },
      "required": [
        "expression"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_tabs",
    "description": "Discover and change browser tabs for this session. action=list (default) returns a TOON table of tab id / url / title / loading. action=open creates or reuses a tab (optional url). action=navigate|back|forward|reload changes that tab's page — pass url, or port (+ optional path) for localhost. action=close discards tabs you opened and are done with — pass one id or an array; it is not undoable, so never close a tab the user is reading. Use the returned tab id as `tab` on other browser tools. Not for clicking or typing (browser_act).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "action": {
          "description": "Default list.",
          "type": "string",
          "enum": [
            "list",
            "open",
            "navigate",
            "back",
            "forward",
            "reload",
            "close"
          ]
        },
        "tab": {
          "description": "Existing tab id to reuse (open) or target (navigate/history/close). An array is only valid with action=close.",
          "anyOf": [
            { "type": "string" },
            { "minItems": 1, "type": "array", "items": { "type": "string" } }
          ]
        },
        "url": {
          "description": "Website URL for open/navigate. Schemeless host gets https; loopback gets http.",
          "type": "string"
        },
        "port": {
          "description": "Localhost port for navigate.",
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        },
        "path": {
          "description": "Optional path/query for the port form.",
          "type": "string"
        },
        "protocol": {
          "description": "Protocol for the port form. Defaults to http.",
          "type": "string",
          "enum": [
            "http",
            "https"
          ]
        },
        "readiness": {
          "description": "'load' waits for loading to stop (default); 'none' returns immediately.",
          "type": "string",
          "enum": [
            "load",
            "none"
          ]
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_act",
    "description": "Act on the page: click, hover, type, press, scroll, drag, select, upload. Send ONE action per call by default. Batch 2–20 only for a sequence you would not stop between (fill a form then submit) — the user sees a batch as one step. Re-read the page between anything else. Prefer a CSS selector from snapshot/query; click/hover also accept text or x/y. engine=auto|cdp|synthetic (default auto). description is shown to the user instead of raw selectors. recording=true saves a video of just this transaction; expect holds it open until a page condition is met. Not for navigation (browser_tabs), waiting (browser_wait_for), or JS (browser_evaluate). Fail-fast: stops at the first error.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "actions": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "click",
                  "hover",
                  "type",
                  "press",
                  "scroll",
                  "drag",
                  "select",
                  "upload"
                ]
              },
              "selector": {
                "type": "string"
              },
              "text": {
                "type": "string"
              },
              "x": {
                "type": "number"
              },
              "y": {
                "type": "number"
              },
              "clear": {
                "type": "boolean"
              },
              "key": {
                "type": "string"
              },
              "modifiers": {
                "type": "array",
                "items": {
                  "type": "string",
                  "enum": [
                    "Alt",
                    "Control",
                    "Meta",
                    "Shift"
                  ]
                }
              },
              "deltaX": {
                "type": "number"
              },
              "deltaY": {
                "type": "number"
              },
              "from": {
                "type": "object",
                "properties": {
                  "selector": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  },
                  "x": {
                    "type": "number"
                  },
                  "y": {
                    "type": "number"
                  }
                },
                "additionalProperties": false
              },
              "to": {
                "type": "object",
                "properties": {
                  "selector": {
                    "type": "string"
                  },
                  "text": {
                    "type": "string"
                  },
                  "x": {
                    "type": "number"
                  },
                  "y": {
                    "type": "number"
                  }
                },
                "additionalProperties": false
              },
              "steps": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "holdMs": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "humanize": {
                "type": "boolean"
              },
              "value": {
                "type": "string"
              },
              "label": {
                "type": "string"
              },
              "index": {
                "type": "integer",
                "minimum": -9007199254740991,
                "maximum": 9007199254740991
              },
              "checked": {
                "type": "boolean"
              },
              "files": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "engine": {
                "type": "string",
                "enum": [
                  "auto",
                  "cdp",
                  "synthetic"
                ]
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          },
          "description": "Normally one action. Use 2–20 only for a single uninterruptible sequence; they run in order, fail-fast."
        },
        "recording": {
          "description": "Save a video of only this action transaction. Default false.",
          "type": "boolean"
        },
        "expect": {
          "description": "Explicit completion condition checked before recording stops.",
          "type": "object",
          "properties": {
            "selector": {
              "type": "string"
            },
            "selectorGone": {
              "type": "string"
            },
            "text": {
              "type": "string"
            },
            "urlIncludes": {
              "type": "string"
            }
          },
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Maximum wait for expect. Default 15000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "actions"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network",
    "description": "Network, downloads, and page environment. Recording ladder: action=start → do an act/navigate → action=wait or stop (lean manifest) → action=body({requestId}) for one response. action=download fetches a URL through the session; action=downloads lists page-triggered captures. action=cookies|mock|emulate need CDP experimental settings, except emulate with only preset/width/height/reset. Prefer snapshot/query for page content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "action": {
          "type": "string",
          "enum": [
            "start",
            "stop",
            "wait",
            "body",
            "download",
            "downloads",
            "cookies",
            "mock",
            "emulate"
          ],
          "description": "Which network/env operation to run."
        },
        "recordingId": {
          "description": "From action=start. Required for stop/wait/body.",
          "type": "string"
        },
        "requestId": {
          "description": "From a stop/wait manifest. Required for body.",
          "type": "string"
        },
        "match": {
          "type": "string"
        },
        "resourceTypes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "captureBodies": {
          "type": "boolean"
        },
        "max": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "keep": {
          "description": "stop only: peek without tearing down.",
          "type": "boolean"
        },
        "url": {
          "description": "wait: substring to match. download: absolute URL. mock: url substring.",
          "type": "string"
        },
        "timeoutMs": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "filename": {
          "type": "string"
        },
        "dir": {
          "description": "download only: absolute directory to save into. Defaults to the configured download directory.",
          "type": "string"
        },
        "state": {
          "type": "string",
          "enum": [
            "all",
            "progressing",
            "completed",
            "failed"
          ]
        },
        "wait": {
          "description": "downloads only: block until captures settle.",
          "type": "boolean"
        },
        "urls": {
          "description": "cookies only.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "status": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "body": {
          "type": "string"
        },
        "contentType": {
          "type": "string"
        },
        "headers": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "clear": {
          "type": "boolean"
        },
        "preset": {
          "description": "emulate: named viewport (no CDP).",
          "type": "string",
          "enum": [
            "mobile",
            "tablet",
            "desktop"
          ]
        },
        "width": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "height": {
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "reset": {
          "type": "boolean"
        },
        "deviceScaleFactor": {
          "type": "number"
        },
        "mobile": {
          "type": "boolean"
        },
        "userAgent": {
          "type": "string"
        },
        "colorScheme": {
          "type": "string",
          "enum": [
            "light",
            "dark",
            "no-preference"
          ]
        },
        "timezone": {
          "type": "string"
        },
        "locale": {
          "type": "string"
        },
        "latitude": {
          "type": "number"
        },
        "longitude": {
          "type": "number"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_action",
    "description": "Saved semantic browser actions (dynamic catalog — list then do). action=list (optional domain; includeSteps to see the full definition). action=do runs one saved action with input. action=save creates or replaces a named flow (domain+name) — read the manual first. This does not record prior browser calls. Use browser_act for one-off clicks/types.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": [
            "list",
            "save",
            "do"
          ],
          "description": "list / save / do."
        },
        "domain": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Semantic domain namespace, normally a hostname such as github.com."
        },
        "name": {
          "type": "string"
        },
        "includeSteps": {
          "type": "boolean"
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "parameters": {
          "default": [],
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "name": {
                "type": "string",
                "pattern": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$",
                "description": "Input name referenced in step templates as ${input.name}."
              },
              "description": {
                "description": "What the caller should provide.",
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              },
              "type": {
                "description": "Optional runtime type constraint.",
                "type": "string",
                "enum": [
                  "string",
                  "number",
                  "boolean",
                  "object",
                  "array"
                ]
              },
              "required": {
                "default": true,
                "type": "boolean"
              },
              "default": {}
            },
            "required": [
              "name",
              "required"
            ],
            "additionalProperties": false
          }
        },
        "steps": {
          "description": "save only: 1-50 flow steps, each {kind:\"tool\"|\"action\"|\"set\"|\"if\"|\"forEach\"|\"repeat\"}. Read read_manual({ domain: \"product\", topic: \"browser\" }) for the grammar before writing them.",
          "minItems": 1,
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          }
        },
        "input": {
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "tab": {
          "type": "string"
        }
      },
      "required": [
        "action"
      ],
      "additionalProperties": false
    }
  },
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
  },
  {
    "name": "computer_apps",
    "description": "Discover and open desktop apps. action=list (default) returns a compact TOON app catalog: one row per app with app, bundleId, running, frontmost, granted, grantScope, pid, windows. Use query to keyword-filter by display name / bundle id / localized aliases (e.g. query=Notes or com.apple.TextEdit). Paginate with offset + limit (default limit 25, max 100); hasMore means call again with offset+=limit. Rows are sorted running/frontmost/granted first. Do NOT dump every window by default \u2014 pass includeRoots=true only when you need @rN roots for multi-window targeting. action=focus|launch accepts display name (any locale) or reverse-DNS bundleId; host resolves to a stable bundleId before the permission grant so one allow covers later snapshot/act. Launch/focus returns a slim {target} confirmation. If the user only asks to open an app, launch once and stop when target is returned. Prefer snapshot+act over focus. When actions target @eN refs, prefer delivery=semantic; otherwise delivery=app-directed. Prefer browser_* / shell when a non-GUI path exists.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "action": {
          "description": "Default list",
          "type": "string",
          "enum": [
            "list",
            "focus",
            "launch"
          ]
        },
        "app": {
          "description": "Display name (any locale) or reverse-DNS bundle id for focus/launch. Prefer bundleId from a prior list when known.",
          "type": "string"
        },
        "query": {
          "description": "list only: keyword filter on app name / bundleId / aliases",
          "type": "string"
        },
        "offset": {
          "description": "list only: pagination offset (default 0)",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "limit": {
          "description": "list only: page size (default 25, max 100)",
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "includeRoots": {
          "description": "list only: also attach discoverable UI roots (@rN). Token-heavy; default false.",
          "type": "boolean"
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_snapshot",
    "description": "Capture an immutable UI snapshot and return stateId (analogous to browser_snapshot for desktop apps). All subsequent query/act/wait_for calls must reference this stateId. mode=visual (and fused) saves the image to a temporary file and returns image.path (not base64). The image is NOT loaded into your context automatically; call Read on image.path if you need to look at pixels, or leave the path as a record for the user. mode=semantic returns accessibility outline with @eN refs (no image). mode=fused = screenshot + AX. Use computer_query on the cached outline for search/expand/inspect without recapturing. capture=window (default) captures only the selected window; coordinates are local to that image and remain valid if the window moves. Use capture=display explicitly when the whole display is required. If the window is resized or moves to a different display scale, input fails closed and a successor observation is created.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "root": {
          "description": "Root id from computer_apps / prior snapshot (@rN). Defaults to focused root.",
          "type": "string"
        },
        "mode": {
          "description": "Default fused",
          "type": "string",
          "enum": [
            "visual",
            "semantic",
            "fused"
          ]
        },
        "capture": {
          "description": "Default window; use display for the full target display",
          "type": "string",
          "enum": [
            "window",
            "display"
          ]
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_zoom",
    "description": "Re-sample a region of the last observation at higher detail, preserving its window/display scope. Saves the image to a temporary file and returns image.path (not base64); Read the path if you need pixels. Does NOT create a new coordinate space \u2014 click coordinates still use the parent stateId space.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string",
          "description": "Parent observation stateId"
        },
        "region": {
          "type": "array",
          "prefixItems": [
            {
              "type": "number"
            },
            {
              "type": "number"
            },
            {
              "type": "number"
            },
            {
              "type": "number"
            }
          ],
          "description": "[x0, y0, x1, y1] in parent coordinate space"
        }
      },
      "required": [
        "description",
        "stateId",
        "region"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_query",
    "description": "Search / expand / inspect the cached outline for a stateId without recapturing the desktop. Use this for progressive disclosure of deep accessibility trees.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "op": {
          "type": "string",
          "enum": [
            "search",
            "expand",
            "inspect"
          ]
        },
        "text": {
          "description": "For search",
          "type": "string"
        },
        "ref": {
          "description": "For expand/inspect (@eN)",
          "type": "string"
        },
        "depth": {
          "description": "For expand",
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": [
        "description",
        "stateId",
        "op"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_act",
    "description": "Submit 1\u201320 related UI actions as a checked transaction against a stateId. Delivery policy (pick explicitly when possible): (1) Prefer delivery=semantic whenever actions use @eN refs and the action is press/setText/click(ref)/typeText(ref) \u2014 pure AX, most reliable for labeled controls. (2) Use delivery=app-directed (runtime default if omitted) for coordinate click/type/scroll/drag/keypress or when no usable AX ref exists \u2014 posts CGEvent to the target app PID in the background without stealing frontmost. (3) Use delivery=physical only when app-directed fails and global HID is required (requires frontmost; disruptive). Actions: click, typeText, keypress, scroll(dx,dy[,x,y|ref]), drag(path\u22652 points), moveMouse, press/setText (AX). scroll: positive dy scrolls content down; aim with x,y (capture space) or ref center; else window/outline center. drag: path is capture-space points; virtual cursor animates along the path. Returns outcome worked|didnt|unknown based on re-observation (not API success codes): worked when AX readback, expect, typed text, or a meaningful successor outline diff confirms effect; unknown only when applied but unprovable; didnt on hard failure or failed expect. When the successor has pixels, successorImage.path contains the fresh screenshot. Set recording=true to save a short video containing only this action transaction. Stale stateId (UI changed since snapshot) is rejected before side effects. delivery=semantic never silently upgrades to app-directed/physical input.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "actions": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "press",
                  "click",
                  "setText",
                  "typeText",
                  "keypress",
                  "scroll",
                  "drag",
                  "moveMouse"
                ]
              },
              "ref": {
                "type": "string"
              },
              "text": {
                "type": "string"
              },
              "x": {
                "type": "number"
              },
              "y": {
                "type": "number"
              },
              "button": {
                "type": "string",
                "enum": [
                  "left",
                  "right"
                ]
              },
              "keys": {
                "type": "array",
                "items": {
                  "type": "string"
                }
              },
              "dx": {
                "type": "number"
              },
              "dy": {
                "type": "number"
              },
              "path": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "x": {
                      "type": "number"
                    },
                    "y": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "x",
                    "y"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        },
        "expect": {
          "description": "Postcondition checked after actions",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains",
                "valueEquals"
              ]
            },
            "ref": {
              "type": "string"
            },
            "text": {
              "type": "string"
            },
            "value": {
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "recording": {
          "description": "Save a video of only this action transaction. Default false.",
          "type": "boolean"
        },
        "timeoutMs": {
          "description": "Maximum wait for expect before the action is judged. Default 5000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        },
        "delivery": {
          "description": "Prefer semantic when actions target @eN refs (press/setText/click/typeText). Omit or app-directed = background postToPid (default). physical = global HID + frontmost only as last resort.",
          "type": "string",
          "enum": [
            "semantic",
            "app-directed",
            "physical"
          ]
        }
      },
      "required": [
        "description",
        "stateId",
        "actions"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "computer_wait_for",
    "description": "Wait until a UI condition holds. Distinguishes preexisting (already true) from verified (became true). Do not sleep+poll with snapshot yourself.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Inspect the meeting notes window', 'Save the edited document'). Shown in the UI in place of raw state ids, element refs, and coordinates. Write it in the conversation's language."
        },
        "stateId": {
          "type": "string"
        },
        "condition": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains",
                "valueEquals"
              ]
            },
            "ref": {
              "type": "string"
            },
            "text": {
              "type": "string"
            },
            "value": {
              "type": "string"
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Default 5000",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "description",
        "stateId",
        "condition"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "widget_list_templates",
    "description": "List reusable widget templates saved in the current project or user scope. Call this when considering template reuse; pass a returned id to widget_show.template.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "widget_show",
    "description": "Render SVG, diagrams, charts, or interactive HTML inline in chat. Pass widget_code for new content, or template + data to reuse a saved template. To show media you produced yourself, pass a @native/* template so it renders in SuperOne's own gallery (viewer, download, drag-out) instead of a lookalike you build in widget_code — call widget_list_templates for the list. Before the first new widget in a session, load the relevant design modules with read_manual({ domain: \"widget\", modules: [...] }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string",
          "description": "Short snake_case identifier for this widget."
        },
        "widget_code": {
          "type": "string"
        },
        "template": {
          "type": "string"
        },
        "data": {
          "type": "object",
          "additionalProperties": true
        },
        "reusable": {
          "type": "object",
          "additionalProperties": true
        },
        "width": {
          "type": "number"
        },
        "height": {
          "type": "number"
        }
      },
      "required": [
        "title"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "automation_list",
    "description": "List scheduled agent automations for the current project (id, name, enabled, schedule, last/next run). Pass id for full detail (prompt, agentConfig, schedule). Filter with query (name) or enabled. Call before automation_apply or automation_delete. Current project only — not session archive tools.",
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
    "description": "Create or update a project automation. create needs name, prompt, schedule; update needs id plus any field (pause via enabled=false). Call automation_list first for ids; remove with automation_delete. Always opens a user confirmation dialog and applies nothing without approval. For schedule and agentConfig shapes see read_manual({ domain: \"product\", topic: \"automation\" }).",
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
    "description": "Permanently delete project automations by id (from automation_list). Always opens a user confirmation dialog. Current project only. Prefer automation_list to choose ids first.",
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
  },
  {
    "name": "mobile_share_file",
    "description": "Share a file from the desktop to the mobile device that is currently viewing this session, so the user can open or save it on their phone. This tool is ONLY available while a mobile device is subscribed to the session \u2014 if it is not in your tool list, no phone is connected. The file is delivered end-to-end encrypted and appears as a file card in the mobile chat. The path MUST point to a file inside the current project directory. Use it when the user asks to send, share, or get a file onto their phone.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "path": {
          "type": "string",
          "description": "Path to the file to send. Absolute, or relative to the project directory. Must resolve inside the project."
        },
        "caption": {
          "type": "string",
          "description": "Optional short note shown next to the file on the phone."
        }
      },
      "required": [
        "path"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_list",
    "description": "Browse the devices this machine can offer, one tier at a time. No arguments: what is running, what this project used before, and which kinds exist. kind: its models. model: its devices, one per runtime, with ids. Prefer a running or recent one — attaching is instant, a cold boot costs ~20s. Free: it grants nothing and boots nothing.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "kind": {
          "description": "Narrow to one family: \"iphone\", \"ipad\", \"watch\", \"tv\", \"vision\". Returns its models.",
          "type": "string"
        },
        "model": {
          "description": "A model name from the kind tier (\"iPhone 17 Pro Max\"). Returns one entry per runtime, with ids.",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "device_request_control",
    "description": "Ask the user to let this session control one device, and wait for their answer. Every other device_* tool fails with NO_DEVICE until this succeeds — call it first, not after a failure. Pick the device from device_list yourself; a decline carries feedback that often names a different one. Returns it bound and booted. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "type": "string",
          "description": "The id from device_list. A name is matched loosely as a fallback, but the id is what makes the approved device the one you meant."
        }
      },
      "required": [
        "description",
        "device"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_snapshot",
    "description": "Capture the screen and return a stateId later calls must quote. Waits for animation to stop. mode=semantic (default) returns the accessibility tree with @eN refs — prefer it: refs survive animation and rotation, coordinates do not. mode=visual saves a PNG and returns image.path (not pixels); Read it to look. fused returns both. Regions with no tree (WebView, canvas) are read from pixels and marked (ocr): tap those, never press. Re-snapshot after anything that changes the screen — refs are positional and device_act rejects a stale stateId. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "mode": {
          "description": "Default semantic",
          "type": "string",
          "enum": [
            "semantic",
            "visual",
            "fused"
          ]
        },
        "maxNodes": {
          "description": "Ceiling on tree size. Default 500; truncated=true means the screen has more.",
          "type": "integer",
          "minimum": 1,
          "maximum": 2000
        }
      },
      "required": [
        "description"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_query",
    "description": "Search or inspect an existing snapshot without re-capturing the device. Prefer it over another snapshot when you only need to find an element or read its details: no device round trip, and it cannot race an animation. op=search matches labels, values and identifiers; op=inspect returns one element and its children.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "stateId": {
          "type": "string",
          "description": "From a prior device_snapshot."
        },
        "op": {
          "type": "string",
          "enum": [
            "search",
            "inspect"
          ]
        },
        "text": {
          "description": "For search.",
          "type": "string"
        },
        "ref": {
          "description": "For inspect, e.g. \"@e12\".",
          "type": "string"
        }
      },
      "required": [
        "description",
        "stateId",
        "op"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_act",
    "description": "Run 1-10 touch actions against a snapshot, then re-observe to judge if they worked. Prefer refs; press survives animation, but use tap for source=ocr and raw x/y only as a last resort. The batch and a stale stateId are validated before any side effect. rotate must be last, then re-snapshot. Returns worked|didnt|unknown; pass expect to define success. See read_manual({ domain: \"product\", topic: \"devices\" }).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "stateId": {
          "type": "string"
        },
        "actions": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "tap",
                  "doubleTap",
                  "longPress",
                  "swipe",
                  "pinch",
                  "press",
                  "type",
                  "key",
                  "rotate",
                  "keyboard"
                ]
              },
              "ref": {
                "description": "Element ref from the snapshot, e.g. \"@e12\". Preferred over coordinates.",
                "type": "string"
              },
              "x": {
                "description": "Horizontal position as a fraction of the screen (0-1). Only when no ref fits.",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "y": {
                "description": "Vertical position as a fraction of the screen (0-1).",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "direction": {
                "description": "swipe: which way the finger travels. Content moves the opposite way, so \"up\" scrolls down a list.",
                "type": "string",
                "enum": [
                  "up",
                  "down",
                  "left",
                  "right"
                ]
              },
              "distance": {
                "description": "swipe: travel as a fraction of the screen. Default 0.6.",
                "type": "number",
                "minimum": 0.05,
                "maximum": 1
              },
              "toX": {
                "description": "swipe: explicit destination instead of direction.",
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "toY": {
                "type": "number",
                "minimum": 0,
                "maximum": 1
              },
              "scale": {
                "description": "pinch: final separation factor. Below 1 pinches in (zoom out), above 1 spreads.",
                "type": "number",
                "minimum": 0.1,
                "maximum": 5
              },
              "durationMs": {
                "description": "How long the gesture takes. Short swipes flick and coast; long ones drag and stop.",
                "type": "integer",
                "minimum": 16,
                "maximum": 10000
              },
              "text": {
                "description": "type: text to enter. Anything the simulated keyboard cannot spell (Chinese, emoji) is pasted automatically.",
                "type": "string"
              },
              "button": {
                "description": "key: a hardware button. `back` and `app-switch` are Android-only and are refused elsewhere.",
                "type": "string",
                "enum": [
                  "home",
                  "lock",
                  "side",
                  "volume-up",
                  "volume-down",
                  "back",
                  "app-switch"
                ]
              },
              "orientation": {
                "type": "string",
                "enum": [
                  "portrait",
                  "landscape-left",
                  "portrait-upside-down",
                  "landscape-right"
                ]
              },
              "connected": {
                "description": "keyboard: attach or detach the hardware keyboard. Detach it to make the on-screen keyboard appear.",
                "type": "boolean"
              }
            },
            "required": [
              "type"
            ],
            "additionalProperties": false
          }
        },
        "expect": {
          "description": "Postcondition checked after the actions run.",
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains"
              ]
            },
            "ref": {
              "description": "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
              "type": "string"
            },
            "label": {
              "description": "Visible name of the element.",
              "type": "string"
            },
            "identifier": {
              "description": "Developer-assigned id. Survives copy changes and translation — the most durable target.",
              "type": "string"
            },
            "text": {
              "description": "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Maximum wait for expect before the action is judged. Default 5000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        },
        "recording": {
          "description": "Save a video of only this action transaction. Default false.",
          "type": "boolean"
        }
      },
      "required": [
        "description",
        "stateId",
        "actions"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "device_wait_for",
    "description": "Wait until the screen satisfies a condition, instead of snapshotting in a loop. Target the element by label or identifier, never by ref: refs belong to one snapshot and what you are waiting for usually does not exist yet — text only says what to compare, it never selects. Returns a fresh settled stateId and tree, and reports preexisting vs verified.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 160,
          "description": "Short explanation of this step for the user watching, in the conversation's language (e.g. 'Open the profile tab'). Shown in place of refs and coordinates."
        },
        "device": {
          "description": "Device id or name from device_list. Optional while this session controls exactly one; required once it holds more. Use device_request_control to be granted another.",
          "type": "string"
        },
        "condition": {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "exists",
                "notExists",
                "textEquals",
                "textContains"
              ]
            },
            "ref": {
              "description": "Only valid within the snapshot it came from; prefer label or identifier when waiting.",
              "type": "string"
            },
            "label": {
              "description": "Visible name of the element.",
              "type": "string"
            },
            "identifier": {
              "description": "Developer-assigned id. Survives copy changes and translation — the most durable target.",
              "type": "string"
            },
            "text": {
              "description": "The string textEquals/textContains compares against. Required by those two kinds, and NOT a way to name an element — use label for that.",
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "kind"
          ],
          "additionalProperties": false
        },
        "timeoutMs": {
          "description": "Default 5000",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "description",
        "condition"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_perf",
    "description": "Profile what a page (or SuperOne itself) burns CPU on: hotspot functions by self time, plus layout/style/heap deltas. Pass `action` to measure ONE interaction: the window opens and closes around it, and a ~1s ambient baseline is subtracted. Omit `action` to profile steady state for `sampleMs` (no baseline; the only mode for target='app'). The reply flags a truncated window or a non-script bottleneck when either applies.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching. Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "target": {
          "description": "'tab' (default) = a browser view. 'app' = SuperOne's own renderer; sample mode only.",
          "type": "string",
          "enum": [
            "tab",
            "app"
          ]
        },
        "action": {
          "description": "Action mode: the action runs inside the profiling window. Omit for sample mode.",
          "type": "object",
          "properties": {
            "tool": {
              "type": "string",
              "description": "Browser primitive to measure, e.g. 'browser_click', 'browser_navigate', 'browser_scroll'."
            },
            "args": {
              "description": "Arguments for that tool, as you would pass them directly.",
              "type": "object",
              "propertyNames": {
                "type": "string"
              },
              "additionalProperties": {}
            }
          },
          "required": [
            "tool"
          ],
          "additionalProperties": false
        },
        "sampleMs": {
          "description": "Sample mode: how long to profile steady-state load. Default 3000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "until": {
          "description": "Action mode: explicit completion signal for an exact window.",
          "type": "object",
          "properties": {
            "urlContains": {
              "type": "string"
            },
            "selector": {
              "type": "string"
            }
          },
          "additionalProperties": false
        },
        "maxWaitMs": {
          "description": "Action mode: upper bound on the wait. Default 10000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        },
        "baselineMs": {
          "description": "Action mode: ambient-load sample length. Default 1000.",
          "type": "integer",
          "minimum": -9007199254740991,
          "maximum": 9007199254740991
        }
      },
      "additionalProperties": false
    }
  }
] as const

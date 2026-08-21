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
    text: { description: "Required by textEquals and textContains.", type: "string" }
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
    button: { type: "string", enum: ["home", "lock", "side", "volume-up", "volume-down"] },
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
    "description": "Request user approval for collaboration launches: \"spawn\" (default) creates a nested child you keep messaging; \"handoff\" creates a top-level sibling that takes the task over one-way (no mailbox); \"link\" opens a mailbox with an existing sessionId. Spawn/handoff: list_agents; require agentId, name, role, summary, task; for cwd/worktree call read_manual({ domain: \"product\", topic: \"collaboration\" }); same-repo isolation belongs in config.worktree. Link: require sessionId + summary; optional task opening (turn-injected, not system prompt). User must approve; credential for session_collab_start.",
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
                "description": "\"spawn\" (default) creates a new child session nested under this one, with a two-way mailbox. \"handoff\" creates a new top-level sibling session that receives the task and owns it from then on \u2014 no mailbox, no reply, not nested. Use it to pass work forward (fresh context, next phase, unattended follow-up) instead of supervising it. \"link\" connects to an already-existing SuperOne session (sessionId required)."
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
                    "description": "How autonomous the child session is. Prefer the most autonomous mode it can finish the task under — \"bypassPermissions\" (shown as Bypass on Claude-family harnesses, Full Access on Codex/Cursor), \"agent\" for Cursor, or \"auto\" for ACP agents. Nobody watches a child session, so a conservative mode strands it on an approval prompt that is never answered. Requesting an autonomous mode is safe by construction: nothing runs until the user approves this very request, and that approval dialog is where they downgrade permission or sandbox per launch. Pick \"plan\" or \"default\" only when stopping for human review is the point of the launch."
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
                    "description": "Set only to a genuinely different project root. Omit for the current project. Never pass ~/.worktrees/... or another same-repo worktree leaf; use config.worktree for same-repo isolation. See read_manual({ domain: \"product\", topic: \"collaboration\" })."
                  },
                  "worktree": {
                    "type": "object",
                    "description": "Request a host-managed worktree for same-repo isolation while cwd stays omitted or at the project root. Use for parallel implementers (mode branch + unique branchName), not for default read-only review of the current shared checkout. Use mode detach only when reviewing a feature branch another implementer already has checked out. See read_manual({ domain: \"product\", topic: \"collaboration\" }).",
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
    "description": "Read bundled SuperOne manuals. Omit domain to list all domains; pass domain to list its topics; pass domain with topic to read one topic. For widget, pass either topic or modules, never both. Use product/contribute for GitHub issues and PRs (issue-first, optional red–green), product/debug for support and runtime paths, miniapp/overview before mini-app development, and media/overview before provider-specific options. Use config_read for live settings and widget_list_templates for saved widgets.",
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
    },
    "_meta": {
      "anthropic/alwaysLoad": true
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
    "description": "Rename the current chat session to a concise topic label shown in the sidebar. Always pass tags (set): 1–4 short kebab-case labels you choose so session_list/session_search can find this chat. Reuse names from session_tag_list when they fit; invent one when they don't.\n\nOnly the top-level agent talking directly to the user may call this. If you were launched as a Task/subagent worker, do NOT call it — you do not own the user-facing session title.\n\nIf the tool returns an error containing \"user_locked\", the user has manually named this session — do not call session_rename again. Tags in the same call were still applied; use session_tag for later tag edits.",
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
          "items": { "type": "string" },
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
    "description": "List SuperOne sessions (metadata only). Default: current project. Pass projectId (from project_list) or allProjects=true. Rows include projectId only — use project_list for path/name. Use before session_read/session_search. Filter by title query, harness, pin/hidden, dates, or tags + tagMatch (any=at least one, all=every tag; default any). Discover tags with session_tag_list. Sort with order (default last_active_desc; also created_*, message_count_*, size_*). When order is size_*, rows include sizeBytes (character length of message JSON, not disk bytes). Paginate with limit/offset. Not live collab or harness resume.",
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
    "description": "Submit an asynchronous video generation after the user reviews its parameters. Stop on cancelled or error; use feedback before retrying a rejected proposal. After submission, poll media_video_status about every 30 seconds until generated or error. The finished video is displayed automatically; do not embed it again. Before provider-specific options, call media_list_providers with category \"video\" and read media/overview plus the matching provider topic. Check warnings for ignored options.",
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
    "name": "browser_action_list",
    "description": "List saved semantic browser actions. Omit domain to list all actions, or pass a domain for an exact normalized-domain match. Returns compact summaries by default; set includeSteps:true before replacing an existing action when you need its complete definition.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain": {
          "description": "Optional domain filter, e.g. github.com. Scheme, path, case, and a trailing dot are normalized away.",
          "type": "string"
        },
        "includeSteps": {
          "default": false,
          "description": "Include complete step definitions. Default false for a lean action catalog.",
          "type": "boolean"
        }
      },
      "required": [
        "includeSteps"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_action_save",
    "description": "Create or replace a reusable semantic browser action. Actions are global across projects and sessions and are keyed by normalized domain + name. Steps run sequentially and support kind:\"tool\", \"action\", \"set\", \"if\", \"forEach\", and \"repeat\". Tool/action steps may saveAs a shared variable. Templates in tool args and nested action input may reference ${input.*}, ${vars.*}, ${result.*}, ${item.*}, and ${index}. Structured expressions use literal scalars, {kind:\"literal\",value}, {kind:\"ref\",path}, or {kind:\"op\",op,args}; arbitrary code is not executed. This tool does not record prior browser calls.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500,
          "description": "Semantic domain namespace, normally a hostname such as github.com."
        },
        "name": {
          "type": "string",
          "pattern": "^[a-z][a-z0-9_-]{0,63}$",
          "description": "Stable lowercase action name using letters, numbers, underscores, or hyphens."
        },
        "description": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000,
          "description": "Concise explanation of the action outcome and when to use it. Do not embed credentials or other secrets in steps; pass them as action inputs."
        },
        "parameters": {
          "default": [],
          "description": "Inputs accepted by browser_action_do. Values are referenced in steps as ${input.name}.",
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
          "minItems": 1,
          "maxItems": 50,
          "type": "array",
          "items": {
            "$ref": "#/$defs/__schema0"
          },
          "description": "Ordered flow steps. set writes to shared vars; if runs then or else; forEach exposes item and index; repeat exposes index. Loops allow at most 50 iterations, definitions at most 50 total steps, and execution at most 100 cumulative steps. Execution is fail-fast."
        }
      },
      "required": [
        "domain",
        "name",
        "description",
        "parameters",
        "steps"
      ],
      "additionalProperties": false,
      "$defs": {
        "__schema0": {
          "description": "A sequential tool, nested action, set, if, forEach, or repeat step. Control-flow child steps execute in order and count toward execution limits.",
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "tool"
                },
                "tool": {
                  "type": "string",
                  "enum": [
                    "browser_snapshot",
                    "browser_query",
                    "browser_inspect",
                    "browser_screenshot",
                    "browser_click",
                    "browser_hover",
                    "browser_type",
                    "browser_navigate",
                    "browser_wait_for",
                    "browser_press",
                    "browser_scroll",
                    "browser_drag",
                    "browser_select",
                    "browser_open",
                    "browser_evaluate",
                    "browser_tabs",
                    "browser_resize",
                    "browser_network_start",
                    "browser_network_stop",
                    "browser_network_wait",
                    "browser_network_body",
                    "browser_cookies",
                    "browser_upload_file",
                    "browser_download",
                    "browser_list_downloads",
                    "browser_emulate",
                    "browser_mock"
                  ]
                },
                "args": {
                  "default": {},
                  "type": "object",
                  "propertyNames": {
                    "type": "string"
                  },
                  "additionalProperties": {}
                },
                "saveAs": {
                  "description": "Save the primitive tool result into vars under this name.",
                  "type": "string",
                  "pattern": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$"
                }
              },
              "required": [
                "kind",
                "tool",
                "args"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "action"
                },
                "domain": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 500
                },
                "name": {
                  "type": "string",
                  "pattern": "^[a-z][a-z0-9_-]{0,63}$"
                },
                "input": {
                  "default": {},
                  "type": "object",
                  "propertyNames": {
                    "type": "string"
                  },
                  "additionalProperties": {}
                },
                "saveAs": {
                  "description": "Save the nested action last result into vars under this name.",
                  "type": "string",
                  "pattern": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$"
                }
              },
              "required": [
                "kind",
                "domain",
                "name",
                "input"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "set"
                },
                "name": {
                  "type": "string",
                  "pattern": "^[A-Za-z_][A-Za-z0-9_-]{0,63}$"
                },
                "value": {
                  "$ref": "#/$defs/__schema1"
                }
              },
              "required": [
                "kind",
                "name",
                "value"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "if"
                },
                "condition": {
                  "$ref": "#/$defs/__schema1"
                },
                "then": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/__schema0"
                  }
                },
                "else": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/__schema0"
                  }
                }
              },
              "required": [
                "kind",
                "condition",
                "then"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "forEach"
                },
                "items": {
                  "$ref": "#/$defs/__schema1"
                },
                "steps": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/__schema0"
                  }
                }
              },
              "required": [
                "kind",
                "items",
                "steps"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "repeat"
                },
                "times": {
                  "$ref": "#/$defs/__schema1"
                },
                "steps": {
                  "minItems": 1,
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/__schema0"
                  }
                }
              },
              "required": [
                "kind",
                "times",
                "steps"
              ],
              "additionalProperties": false
            }
          ]
        },
        "__schema1": {
          "description": "A literal JSON scalar, {kind:\"literal\",value:any JSON}, {kind:\"ref\",path:\"input|vars|result|item|index...\"}, or {kind:\"op\",op,args}. Operators: eq, ne, gt, gte, lt, lte, and, or, not, exists, contains, add, subtract, multiply, divide.",
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "number"
            },
            {
              "type": "boolean"
            },
            {
              "type": "null"
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "literal"
                },
                "value": {}
              },
              "required": [
                "kind",
                "value"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "ref"
                },
                "path": {
                  "type": "string",
                  "pattern": "^(?:input|vars|result|item|index)(?:\\.[A-Za-z0-9_-]+)*$"
                }
              },
              "required": [
                "kind",
                "path"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "const": "op"
                },
                "op": {
                  "type": "string",
                  "enum": [
                    "eq",
                    "ne",
                    "gt",
                    "gte",
                    "lt",
                    "lte",
                    "and",
                    "or",
                    "not",
                    "exists",
                    "contains",
                    "add",
                    "subtract",
                    "multiply",
                    "divide"
                  ]
                },
                "args": {
                  "minItems": 1,
                  "maxItems": 20,
                  "type": "array",
                  "items": {
                    "$ref": "#/$defs/__schema1"
                  }
                }
              },
              "required": [
                "kind",
                "op",
                "args"
              ],
              "additionalProperties": false
            }
          ]
        }
      }
    }
  },
  {
    "name": "browser_action_do",
    "description": "Execute one saved semantic browser action, including flow control and nested actions. Call browser_action_list first when you do not know its parameters. Variables are shared across nested actions for the duration of this call. Execution is sequential and fail-fast, detects recursive action cycles, and returns the last primitive tool result plus the actual step count. The domain is a semantic namespace only and does not restrict navigation.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "domain": {
          "type": "string",
          "description": "Action domain namespace. Normalized before lookup."
        },
        "name": {
          "type": "string",
          "description": "Saved action name."
        },
        "input": {
          "default": {},
          "description": "Values for the action parameters.",
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {}
        },
        "tab": {
          "description": "Browser view id inherited by tab-scoped primitive steps unless a step sets its own tab.",
          "type": "string"
        }
      },
      "required": [
        "domain",
        "name",
        "input"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_snapshot",
    "description": "Inspect the current browser page. Pick which data sections to return via `include`: 'meta' (url/title/loading), 'elements' (flat list of top interactive elements + CSS selectors + total count), 'tree' (hierarchical accessibility tree of landmarks/headings/interactive nodes \u2014 use when you need page STRUCTURE and nesting, not just a flat list), 'text' (truncated visible text), 'console' (recent console entries, filterable). Default include is ['meta','elements','console'] (lean, warning+error console only). Fetch just logs with include:['console'] \u2014 that skips the DOM scan entirely. Call this first to orient. The result is TOON, not JSON: arrays render as a header row `name[N]{col,col}:` followed by one indented CSV-style row per item.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "include": {
          "default": [
            "meta",
            "elements",
            "console"
          ],
          "description": "Which data sections to return. Default ['meta','elements','console'].",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "meta",
              "elements",
              "tree",
              "text",
              "console"
            ]
          }
        },
        "filter": {
          "description": "Elements section only: case-insensitive substring; only return interactive elements whose name or role contains it.",
          "type": "string"
        },
        "max": {
          "default": 40,
          "description": "Elements section only: max interactive elements, ranked by viewport proximity. Default 40.",
          "type": "integer",
          "minimum": 1,
          "maximum": 200
        },
        "depth": {
          "default": 12,
          "description": "Tree section only: max nesting depth to descend. Default 12.",
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "treeMax": {
          "default": 150,
          "description": "Tree section only: max nodes to emit (overload budget). When hit, the tree is cut and treeTruncated:true is returned. Default 150.",
          "type": "integer",
          "minimum": 1,
          "maximum": 500
        },
        "textMaxChars": {
          "default": 4000,
          "description": "Text section only: truncate visible text to this many chars. Default 4000.",
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        },
        "console": {
          "description": "Console section filtering. Only consulted when `include` contains 'console'.",
          "type": "object",
          "properties": {
            "level": {
              "description": "Console levels to include. Default ['warning','error']. Pass all four for everything.",
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
              "description": "Only return console entries whose text matches this pattern (substring by default).",
              "type": "string"
            },
            "regex": {
              "default": false,
              "description": "Treat grep as a JS regular expression instead of a substring. Default false.",
              "type": "boolean"
            },
            "ignoreCase": {
              "default": true,
              "description": "Case-insensitive grep. Default true.",
              "type": "boolean"
            },
            "invert": {
              "default": false,
              "description": "Keep only entries that do NOT match grep (like grep -v). Default false.",
              "type": "boolean"
            },
            "max": {
              "default": 50,
              "description": "Return the most recent N matching entries. Default 50.",
              "type": "integer",
              "minimum": 1,
              "maximum": 200
            }
          },
          "required": [
            "regex",
            "ignoreCase",
            "invert",
            "max"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "include",
        "max",
        "depth",
        "treeMax",
        "textMaxChars"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_query",
    "description": "Find elements on the page by structured criteria. Combine role, text, css selector, and attribute matchers. Returns matching elements with reusable selectors plus the total match count, as TOON (matches render as a `matches[N]{...}:` table + rows). Use this instead of snapshot when you already know what you are looking for.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "role": {
          "description": "Match ARIA role or tag name, e.g. 'button', 'textbox', 'link'.",
          "type": "string"
        },
        "text": {
          "description": "Case-insensitive substring in the element's accessible name or text.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector to match. Combine with role/text or use alone.",
          "type": "string"
        },
        "attributes": {
          "description": "Attribute equals matchers, e.g. { type: 'submit' }.",
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "visible": {
          "default": true,
          "description": "Only return visible elements. Default true.",
          "type": "boolean"
        },
        "max": {
          "default": 20,
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "fields": {
          "description": "Extra per-match fields beyond the lean reference. Omit for the cheapest result.",
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "text",
              "html",
              "attributes",
              "value",
              "box"
            ]
          }
        }
      },
      "required": [
        "visible",
        "max"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_inspect",
    "description": "Get detail on one element identified by a CSS selector (typically from a snapshot or query result). Choose which fields to return; \"context\" adds the ancestor chain, associated labels, and the enclosing form.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "type": "string",
          "description": "CSS selector of the element to inspect."
        },
        "fields": {
          "default": [
            "text",
            "attributes",
            "box"
          ],
          "description": "Which detail fields to return.",
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
          "default": 4000,
          "description": "Truncate text/html to this many characters.",
          "type": "integer",
          "minimum": 0,
          "maximum": 20000
        }
      },
      "required": [
        "selector",
        "fields",
        "maxChars"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_screenshot",
    "description": "Capture a PNG screenshot of the visible viewport (or one element when a selector is given), save it to disk, and return its file path plus width/height. Oversized files are JPEG-re-encoded (same dimensions) for cheaper Read. To capture content below the fold, scroll to it first (browser_scroll) and screenshot again. The image is NOT loaded into your context automatically \u2014 if you actually need to look at it, call Read on the returned path. Prefer the text tools (snapshot/query/inspect) first; use a screenshot when pixels matter or to leave a visual record for the user.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector to screenshot just that element. Omit for the visible viewport.",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_click",
    "description": "Click one element. Prefer selector with a CSS selector from snapshot/query. Alternatively pass text to click the first matching visible element, or x/y viewport coordinates. Provide exactly one targeting mode.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector of the element to click.",
          "type": "string"
        },
        "text": {
          "description": "Click the first visible element whose accessible name or text contains this substring.",
          "type": "string"
        },
        "x": {
          "description": "Viewport X coordinate in CSS pixels. Must be paired with y.",
          "type": "number"
        },
        "y": {
          "description": "Viewport Y coordinate in CSS pixels. Must be paired with x.",
          "type": "number"
        },
        "engine": {
          "default": "auto",
          "description": "'auto' (default): trusted CDP click when the CDP setting is on, else synthetic. 'cdp': trusted click via the browser input pipeline \u2014 needed for pointer-event UIs (e.g. Radix), popups/window.open, file pickers, autoplay, canvas; errors if the CDP setting is off. 'synthetic': untrusted DOM mouse events only \u2014 fine for a plain button/link.",
          "type": "string",
          "enum": [
            "auto",
            "cdp",
            "synthetic"
          ]
        }
      },
      "required": [
        "engine"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_hover",
    "description": "Hover the pointer over one element without clicking. Reveals hover-triggered UI: dropdown/flyout menus, tooltips, and controls that only appear on mouseover. Prefer selector with a CSS selector from snapshot/query; alternatively pass text to match the first visible element, or x/y viewport coordinates. Provide exactly one targeting mode. After hovering, snapshot/query again to read whatever the hover revealed.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector of the element to hover.",
          "type": "string"
        },
        "text": {
          "description": "Hover the first visible element whose accessible name or text contains this substring.",
          "type": "string"
        },
        "x": {
          "description": "Viewport X coordinate in CSS pixels. Must be paired with y.",
          "type": "number"
        },
        "y": {
          "description": "Viewport Y coordinate in CSS pixels. Must be paired with x.",
          "type": "number"
        },
        "engine": {
          "default": "auto",
          "description": "'auto' (default): trusted CDP mouse move when the CDP setting is on, else synthetic. 'cdp': trusted hover via the browser input pipeline \u2014 needed for menus/tooltips gated on real pointer events (e.g. Radix, native title tooltips); errors if the CDP setting is off. 'synthetic': untrusted DOM pointer/mouse events only (pointerover/mouseover/mouseenter/mousemove) \u2014 fine for CSS :hover and most JS handlers.",
          "type": "string",
          "enum": [
            "auto",
            "cdp",
            "synthetic"
          ]
        }
      },
      "required": [
        "engine"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_type",
    "description": "Type text into an input. Prefer selector with a CSS selector; if omitted, types into the currently focused element. Set clear=true to replace existing text. Dispatches native input/change events so framework-controlled inputs update.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "text": {
          "type": "string",
          "description": "Literal text to insert."
        },
        "selector": {
          "description": "CSS selector of the input. Omit to type into the focused element.",
          "type": "string"
        },
        "clear": {
          "default": false,
          "description": "Clear the existing value before typing. Default false.",
          "type": "boolean"
        },
        "engine": {
          "default": "synthetic",
          "description": "'synthetic' (default): sets the value natively and fires input/change \u2014 enough for ordinary framework-controlled inputs. 'cdp': trusted insert via the browser editing pipeline \u2014 use for rich editors (Monaco, CodeMirror, ProseMirror), masked/per-keystroke inputs, or logic gated on trusted events; requires the CDP setting. Neither engine emits per-character keydown.",
          "type": "string",
          "enum": [
            "synthetic",
            "cdp"
          ]
        }
      },
      "required": [
        "text",
        "clear",
        "engine"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_navigate",
    "description": "Change the page the browser shows. Provide exactly one of: url (a website), port (a local dev-server on localhost), or action (back/forward/reload to move through history). Waits for the page to stop loading by default.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "url": {
          "description": "Website URL, e.g. https://example.com. A schemeless host like 'example.com' gets https; loopback gets http.",
          "type": "string"
        },
        "port": {
          "description": "Local dev-server port on localhost.",
          "type": "integer",
          "minimum": 1,
          "maximum": 65535
        },
        "path": {
          "description": "Optional path/query for the port form, e.g. '/settings'.",
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
        "action": {
          "description": "Move through history instead of loading a URL.",
          "type": "string",
          "enum": [
            "back",
            "forward",
            "reload"
          ]
        },
        "readiness": {
          "default": "load",
          "description": "'load' waits for loading to stop (default); 'none' returns immediately.",
          "type": "string",
          "enum": [
            "load",
            "none"
          ]
        }
      },
      "required": [
        "readiness"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_wait_for",
    "description": "Block until the page reaches a desired state, then return. Provide at least one condition; all are AND-combined: a css selector that must be visible, a selector that must be gone (e.g. a loading spinner), a visible-text substring, and/or a URL substring. Use after click/type/navigate when the page changes asynchronously. Defaults to 15s, max 60s.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "description": "CSS selector that must be present and visible.",
          "type": "string"
        },
        "selectorGone": {
          "description": "CSS selector that must be absent or hidden (e.g. a spinner that should disappear).",
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
          "default": 15000,
          "description": "Maximum wait in milliseconds. Default 15000, max 60000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "timeoutMs"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_press",
    "description": "Press one keyboard key, e.g. { key: 'Enter' }, { key: 'Escape' }, or { key: 'a', modifiers: ['Meta'] }. Targets the element at selector, or the focused element if omitted. Enter submits the enclosing form when no modifiers are held.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "key": {
          "type": "string",
          "minLength": 1,
          "description": "Key name such as Enter, Escape, Tab, ArrowDown, Backspace, or a single character."
        },
        "modifiers": {
          "description": "Modifier keys held while pressing.",
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
        "selector": {
          "description": "CSS selector of the key target. Omit to target the focused element.",
          "type": "string"
        },
        "engine": {
          "default": "synthetic",
          "description": "'synthetic' (default): a DOM KeyboardEvent \u2014 enough for JS key handlers (shortcuts, Enter-to-submit, Escape) but untrusted, no native browser behavior. 'cdp': trusted key via the browser input pipeline \u2014 use when a key must move focus (Tab), type into a native input, trigger a browser shortcut, or when a synthetic press had no effect; requires the CDP setting.",
          "type": "string",
          "enum": [
            "synthetic",
            "cdp"
          ]
        }
      },
      "required": [
        "key",
        "engine"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_scroll",
    "description": "Scroll by CSS pixels. Positive deltaY scrolls down, positive deltaX scrolls right. Without a selector it scrolls the viewport; with one it scrolls that container. Provide at least one delta. Useful to trigger lazy-loading or reveal off-screen elements.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "deltaX": {
          "description": "Horizontal scroll in CSS pixels. Positive scrolls right.",
          "type": "number"
        },
        "deltaY": {
          "description": "Vertical scroll in CSS pixels. Positive scrolls down.",
          "type": "number"
        },
        "selector": {
          "description": "CSS selector of a scrollable container. Omit to scroll the viewport.",
          "type": "string"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_drag",
    "description": "Drag from a source point to a destination point. Handles both pointer-driven gestures (sliders, sortable lists, canvas panning, drag-resize) and native HTML5 drag-and-drop (elements with draggable=true, e.g. kanban cards and file drop zones) \u2014 with the browser CDP setting on, it auto-detects which and drives trusted events for either. Target the source via `from` and the destination via `to`, each by selector, visible text, or x/y viewport coordinates. Tip: enable the browser CDP setting for reliable drags; without it, a best-effort synthetic fallback is used.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "from": {
          "type": "object",
          "properties": {
            "selector": {
              "description": "CSS selector of the element.",
              "type": "string"
            },
            "text": {
              "description": "Match the first visible element whose accessible name or text contains this substring.",
              "type": "string"
            },
            "x": {
              "description": "Viewport X coordinate in CSS pixels. Must be paired with y.",
              "type": "number"
            },
            "y": {
              "description": "Viewport Y coordinate in CSS pixels. Must be paired with x.",
              "type": "number"
            }
          },
          "additionalProperties": false,
          "description": "Drag source. Provide exactly one targeting mode: selector, text, or x+y."
        },
        "to": {
          "type": "object",
          "properties": {
            "selector": {
              "description": "CSS selector of the element.",
              "type": "string"
            },
            "text": {
              "description": "Match the first visible element whose accessible name or text contains this substring.",
              "type": "string"
            },
            "x": {
              "description": "Viewport X coordinate in CSS pixels. Must be paired with y.",
              "type": "number"
            },
            "y": {
              "description": "Viewport Y coordinate in CSS pixels. Must be paired with x.",
              "type": "number"
            }
          },
          "additionalProperties": false,
          "description": "Drag destination. Provide exactly one targeting mode: selector, text, or x+y."
        },
        "steps": {
          "default": 10,
          "description": "Number of intermediate move events between source and target. More steps = a slower, smoother drag (each step adds a small delay); fewer = a faster drag. Default 10.",
          "type": "integer",
          "minimum": 1,
          "maximum": 50
        },
        "holdMs": {
          "default": 0,
          "description": "Time in milliseconds to pause on the target after arriving, before releasing/dropping. Some drop zones only register the drop after a hover. Default 0.",
          "type": "integer",
          "minimum": 0,
          "maximum": 10000
        },
        "humanize": {
          "default": false,
          "description": "When true, vary per-step timing and add positional jitter along an ease-in-out motion curve to mimic a human drag. Improves success on libraries that reject robotic linear moves. The final position is still exact. Default false.",
          "type": "boolean"
        }
      },
      "required": [
        "from",
        "to",
        "steps",
        "holdMs",
        "humanize"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_select",
    "description": "Set the value of a <select> dropdown (by value, visible label, or index) or toggle a checkbox/radio (by checked). Provide the selector plus exactly one of value, label, index, or checked. Dispatches native change events.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "type": "string",
          "description": "CSS selector of the <select>, checkbox, or radio."
        },
        "value": {
          "description": "Option value to select (for <select>).",
          "type": "string"
        },
        "label": {
          "description": "Visible option text to select (for <select>); exact match preferred, falls back to substring.",
          "type": "string"
        },
        "index": {
          "description": "Zero-based option index (for <select>).",
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "checked": {
          "description": "Desired checked state (for checkbox/radio). Defaults to true.",
          "type": "boolean"
        }
      },
      "required": [
        "selector"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_open",
    "description": "Open a new browser tab (optionally at a URL) and return its tab id. Use this when no browser is open yet, or to start a fresh page. Pass the returned tab id as the \"tab\" argument to the other browser tools. Waits for the page to stop loading by default.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "url": {
          "description": "Initial URL. A schemeless host like 'example.com' gets https; loopback gets http. Defaults to a blank tab.",
          "type": "string"
        },
        "tab": {
          "description": "Existing browser tab id to reuse/focus instead of creating a new one.",
          "type": "string"
        },
        "readiness": {
          "default": "load",
          "description": "'load' waits for loading to stop (default); 'none' returns as soon as the tab exists.",
          "type": "string",
          "enum": [
            "load",
            "none"
          ]
        }
      },
      "required": [
        "readiness"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_evaluate",
    "description": "Evaluate a JavaScript expression in the page and return its serializable result. Prefer snapshot and the semantic action tools; use evaluate only for inspection or interactions those tools cannot express. The expression runs in the page and may mutate its state. A returned Promise is awaited. A large result (>32KB serialized) is written to a temp file and returned as { spilled:true, path, bytes, preview } \u2014 Read/grep the path for the full value instead of it flooding context.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "expression": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64000,
          "description": "JavaScript expression, e.g. document.title or (() => ({ items: [...document.querySelectorAll(\"li\")].map(li => li.textContent) }))()."
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
    "description": "List the browser tabs available to this session, each with its tab id, url, title, and loading state (result in TOON: a `tabs[N]{...}:` table). Use the returned tab id as the \"tab\" argument to target a specific tab. Only tabs belonging to this session are listed.",
    "inputSchema": {
      "type": "object",
      "properties": {},
      "additionalProperties": false
    }
  },
  {
    "name": "browser_resize",
    "description": "Resize the browser viewport to test responsive layouts \u2014 no CDP setting required. Pass a preset ('mobile' 375\u00d7812, 'tablet' 768\u00d71024, 'desktop' 1280\u00d7800) or explicit width/height (CSS pixels). Pass reset:true to restore the panel's natural size. Only responsive pages (with a width=device-width viewport meta) reflow; non-responsive pages keep their wide layout. For device-pixel-ratio, touch emulation, user-agent, color scheme, timezone, or geolocation, use browser_emulate instead (it requires the CDP setting).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "preset": {
          "description": "Named viewport size: mobile 375\u00d7812, tablet 768\u00d71024, desktop 1280\u00d7800.",
          "type": "string",
          "enum": [
            "mobile",
            "tablet",
            "desktop"
          ]
        },
        "width": {
          "description": "Explicit viewport width in CSS pixels (pair with height). Overrides preset.",
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "height": {
          "description": "Explicit viewport height in CSS pixels (pair with width). Overrides preset.",
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        },
        "reset": {
          "description": "Restore the panel's natural size, clearing any resize.",
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network_start",
    "description": "Start recording network requests on a tab (requires the browser CDP setting). Nothing is captured until you start, and capture is torn down with zero overhead when you stop \u2014 so record only around the action you care about. Response bodies of matching requests are captured EAGERLY, so they are always readable later (never lost to the browser's cache eviction). Typical flow: browser_network_start \u2192 do an action (browser_click / browser_navigate) \u2192 browser_network_stop to collect exactly what that action triggered. Scope with `match` + `resourceTypes` to keep it lean.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "match": {
          "description": "Only record requests whose URL contains this substring. Omit to record everything (within resourceTypes).",
          "type": "string"
        },
        "resourceTypes": {
          "description": "Resource types to record, case-insensitive: XHR, Fetch, Document, Script, Image, Stylesheet, Font, Media, WebSocket. Default ['XHR','Fetch'] (the app's own API calls). Pass ['*'] for all types.",
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "captureBodies": {
          "default": true,
          "description": "Capture response bodies of matching requests. Default true. Set false to record only metadata + headers (cheaper).",
          "type": "boolean"
        },
        "max": {
          "default": 200,
          "description": "Max requests to record before ignoring further ones. Default 200.",
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        }
      },
      "required": [
        "captureBodies",
        "max"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network_stop",
    "description": "Stop a recording started with browser_network_start and return a lean manifest of what it captured, as TOON (a compact tabular format \u2014 read the rows top-to-bottom). Each row has requestId, method, status, resourceType, url, and bodyBytes \u2014 enough to scan and pick which requests matter. It deliberately does NOT include headers, the request payload, or the response body: read one request's full detail (headers + payload + response body) on demand with browser_network_body({ recordingId, requestId }), so a many-request recording never floods context. Bodies stay readable after stop (recent recordings are retained). Pass keep:true to read the manifest so far WITHOUT stopping (peek during a long-running action).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "recordingId": {
          "type": "string",
          "description": "The id returned by browser_network_start."
        },
        "keep": {
          "default": false,
          "description": "Keep recording (peek) instead of stopping. Default false: stop and tear down capture.",
          "type": "boolean"
        }
      },
      "required": [
        "recordingId",
        "keep"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network_wait",
    "description": "Within an active recording, block until a recorded request whose URL contains the given substring finishes, then return its manifest row as TOON (requestId, method, status, resourceType, url, bodyBytes; read the full detail/body with browser_network_body via requestId). Use after an action that fires an async XHR/fetch, before browser_network_stop, instead of guessing a delay. Default timeout 15s, max 60s.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "recordingId": {
          "type": "string",
          "description": "The id returned by browser_network_start."
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "description": "Substring the request URL must contain."
        },
        "timeoutMs": {
          "default": 15000,
          "description": "Maximum wait in milliseconds. Default 15000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": [
        "recordingId",
        "url",
        "timeoutMs"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network_body",
    "description": "Read one recorded request's full detail on demand (result in TOON), by the requestId from a browser_network_stop / browser_network_wait manifest: method, url, status, mimeType, requestHeaders, requestBody (POST payload), responseHeaders, and the full response body. Reads from the recording's own captured store (not the browser's volatile cache), so it works even for large bodies long after the request finished. A large response body is written to a temp file and returned as { spilled:true, path, bytes, preview } \u2014 Read/grep the path. Works while the recording is active or after it has stopped (recent recordings are retained).",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "recordingId": {
          "type": "string",
          "description": "The id returned by browser_network_start."
        },
        "requestId": {
          "type": "string",
          "description": "The requestId of the entry (from the stop/wait manifest) whose detail to read."
        }
      },
      "required": [
        "recordingId",
        "requestId"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_cookies",
    "description": "Read the cookies visible to the page (experimental; requires the browser CDP setting + cookie-access sub-setting). Returns name, value, domain, path, and key flags as TOON (a `cookies[N]{...}:` table). Long cookie values are truncated (a valueLength field carries the original length). Pass urls to scope to specific URLs.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "urls": {
          "description": "Only return cookies that would be sent to these URLs. Omit for the current page.",
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_upload_file",
    "description": "Set the files on a file <input> element (requires the browser CDP setting). This is the only way to attach files to an upload control, which cannot be driven by synthetic events. Provide the input selector and absolute file paths.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "selector": {
          "type": "string",
          "description": "CSS selector of the file <input> element (input[type=file])."
        },
        "files": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Absolute paths of the files to attach."
        }
      },
      "required": [
        "selector",
        "files"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_download",
    "description": "Fetch a file by URL and save it to disk through the browser session (cookies/auth apply, no CORS; data: URLs ok). Completes synchronously if finished within `timeoutMs`; otherwise continues in the background and returns status 'background' with a taskId \u2014 you will receive a task notification when it finishes. For downloads the page starts itself (export buttons, attachment links), click first then use browser_list_downloads. Files land in a temp dir \u2014 Read the path, or copy/move if the user wants it kept.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "url": {
          "type": "string",
          "minLength": 1,
          "description": "Absolute URL (or data: URL) of the file to download."
        },
        "filename": {
          "description": "Override the saved file name. Defaults to Content-Disposition or the URL path segment.",
          "type": "string"
        },
        "timeoutMs": {
          "default": 15000,
          "description": "How long to wait for a synchronous result before moving the job to the background. Default 15000.",
          "type": "integer",
          "minimum": 100,
          "maximum": 120000
        }
      },
      "required": [
        "url",
        "timeoutMs"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_list_downloads",
    "description": "List files the page triggered for download in this session (export buttons, Content-Disposition links, etc.). Captures are saved automatically without a save dialog. Newest first. Use after browser_click on a download control. Set wait:true to block until at least one matching capture is terminal and nothing is still progressing (or until timeout). Filter with state. This is observation only \u2014 to fetch a known URL use browser_download.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "state": {
          "default": "all",
          "description": "Which captures to include. 'failed' = cancelled or interrupted. Default all.",
          "type": "string",
          "enum": [
            "all",
            "progressing",
            "completed",
            "failed"
          ]
        },
        "wait": {
          "default": false,
          "description": "If true, wait for captures to settle (see timeoutMs). Default false (immediate snapshot).",
          "type": "boolean"
        },
        "timeoutMs": {
          "default": 15000,
          "description": "Max wait when wait is true. Default 15000. Ignored when wait is false.",
          "type": "integer",
          "minimum": 0,
          "maximum": 120000
        }
      },
      "required": [
        "state",
        "wait",
        "timeoutMs"
      ],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_emulate",
    "description": "Emulate device and environment conditions for the page (experimental; requires the browser CDP setting + device-emulation sub-setting): viewport size, device scale, mobile mode, user agent, color scheme, timezone, locale, and geolocation. Pass reset:true to clear all overrides; they persist until reset or the tab is closed. width/height reflow only responsive pages (with a width=device-width viewport meta); non-responsive pages keep their wide layout.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "width": {
          "description": "Viewport width in CSS pixels (pair with height).",
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "height": {
          "description": "Viewport height in CSS pixels (pair with width).",
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "deviceScaleFactor": {
          "description": "Device pixel ratio. 0 keeps the default.",
          "type": "number",
          "minimum": 0
        },
        "mobile": {
          "description": "Emulate a mobile device (touch, mobile viewport).",
          "type": "boolean"
        },
        "userAgent": {
          "description": "Override the User-Agent header.",
          "type": "string"
        },
        "colorScheme": {
          "description": "Emulate prefers-color-scheme.",
          "type": "string",
          "enum": [
            "light",
            "dark",
            "no-preference"
          ]
        },
        "timezone": {
          "description": "IANA timezone id, e.g. 'America/New_York'.",
          "type": "string"
        },
        "locale": {
          "description": "Locale, e.g. 'en-US' or 'ja-JP'.",
          "type": "string"
        },
        "latitude": {
          "description": "Geolocation latitude (pair with longitude).",
          "type": "number"
        },
        "longitude": {
          "description": "Geolocation longitude (pair with latitude).",
          "type": "number"
        },
        "reset": {
          "description": "Clear all emulation overrides.",
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_mock",
    "description": "Intercept matching network requests and respond with a mocked response (experimental; requires the browser CDP setting + network-mocking sub-setting). Provide a url substring to match and the response to return. Pass clear:true to remove all mocks. WARNING: this can read and alter all page traffic \u2014 use only in trusted scenarios.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": {
          "description": "Browser view id. Omit to target the focused browser view (errors if multiple are open).",
          "type": "string"
        },
        "description": {
          "description": "A short, human-friendly explanation of what this action accomplishes, phrased for the end user watching (e.g. 'Fill in the login email', 'Submit the checkout form'). Shown in the UI in place of the raw selector. Write it in the conversation's language.",
          "type": "string"
        },
        "url": {
          "description": "Substring; requests whose URL contains it are fulfilled with the mock. Required unless clear is set.",
          "type": "string"
        },
        "status": {
          "description": "HTTP status code to return (default 200).",
          "type": "integer",
          "minimum": 100,
          "maximum": 599
        },
        "body": {
          "description": "Response body to return (default empty).",
          "type": "string"
        },
        "contentType": {
          "description": "Response Content-Type (default 'application/json').",
          "type": "string"
        },
        "headers": {
          "description": "Extra response headers.",
          "type": "object",
          "propertyNames": {
            "type": "string"
          },
          "additionalProperties": {
            "type": "string"
          }
        },
        "clear": {
          "description": "Remove all mock rules for this tab and stop intercepting.",
          "type": "boolean"
        }
      },
      "additionalProperties": false
    }
  },
  {
    "name": "browser_act",
    "description": "Submit 1–20 page actions as one call: click, hover, type, press, scroll, drag, select, upload. Prefer a CSS selector from snapshot/query; click/hover also accept text or x/y. engine=auto|cdp|synthetic (default auto). description is shown to the user instead of raw selectors. Do not use this to navigate (browser_tabs), wait (browser_wait_for), or run JS (browser_evaluate). Fail-fast: stops at the first error.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "tab": { "type": "string" },
        "description": { "type": "string" },
        "actions": {
          "type": "array",
          "minItems": 1,
          "maxItems": 20,
          "items": {
            "type": "object",
            "properties": {
              "type": { "type": "string", "enum": ["click", "hover", "type", "press", "scroll", "drag", "select", "upload"] }
            },
            "required": ["type"],
            "additionalProperties": true
          }
        }
      },
      "required": ["actions"],
      "additionalProperties": false
    }
  },
  {
    "name": "browser_network",
    "description": "Network, downloads, and page environment. Recording ladder: action=start → do an act/navigate → action=wait or stop (lean manifest) → action=body({requestId}) for one response. action=download fetches a URL through the session; action=downloads lists page-triggered captures. action=cookies|mock|emulate need CDP experimental settings. emulate with only preset/width/height/reset resizes without CDP. Prefer snapshot/query for page content.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": ["start", "stop", "wait", "body", "download", "downloads", "cookies", "mock", "emulate"]
        },
        "tab": { "type": "string" },
        "description": { "type": "string" },
        "recordingId": { "type": "string" },
        "requestId": { "type": "string" },
        "url": { "type": "string" }
      },
      "required": ["action"],
      "additionalProperties": true
    }
  },
  {
    "name": "browser_action",
    "description": "Saved semantic browser actions (dynamic catalog — list then do). action=list (optional domain; includeSteps to see the full definition). action=save creates or replaces a named flow (domain+name). action=do runs one saved action with input. This does not record prior browser calls. Use browser_act for one-off clicks/types.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": { "type": "string", "enum": ["list", "save", "do"] },
        "domain": { "type": "string" },
        "name": { "type": "string" },
        "input": { "type": "object", "additionalProperties": true }
      },
      "required": ["action"],
      "additionalProperties": true
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
    "description": "Submit 1\u201320 related UI actions as a checked transaction against a stateId. Delivery policy (pick explicitly when possible): (1) Prefer delivery=semantic whenever actions use @eN refs and the action is press/setText/click(ref)/typeText(ref) \u2014 pure AX, most reliable for labeled controls. (2) Use delivery=app-directed (runtime default if omitted) for coordinate click/type/scroll/drag/keypress or when no usable AX ref exists \u2014 posts CGEvent to the target app PID in the background without stealing frontmost. (3) Use delivery=physical only when app-directed fails and global HID is required (requires frontmost; disruptive). Actions: click, typeText, keypress, scroll(dx,dy[,x,y|ref]), drag(path\u22652 points), moveMouse, press/setText (AX). scroll: positive dy scrolls content down; aim with x,y (capture space) or ref center; else window/outline center. drag: path is capture-space points; virtual cursor animates along the path. Returns outcome worked|didnt|unknown based on re-observation (not API success codes): worked when AX readback, expect, typed text, or a meaningful successor outline diff confirms effect; unknown only when applied but unprovable; didnt on hard failure or failed expect. When the successor has pixels, successorImage.path contains the fresh screenshot. Stale stateId (UI changed since snapshot) is rejected before side effects. delivery=semantic never silently upgrades to app-directed/physical input.",
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
    "description": "Create or update a project automation. action=create needs name, prompt, schedule; agentConfig optional (defaults claude + bypassPermissions). action=update needs id plus any of name/prompt/enabled/schedule/agentConfig (toggle via enabled). Always set schedule.summary to a short natural-language phrase for the UI (user language). Always opens a user confirmation dialog; applies nothing without approval. Call automation_list first for ids. Delete with automation_delete.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string",
          "enum": ["create", "update"],
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
          "description": "When to run. one-time needs runAt (ISO). recurring needs cron (e.g. \"0 9 * * *\"). Always include summary: natural language for the confirm UI in the user's language (e.g. \"Every weekday at 9:00 AM\", \"每天上午 9 点\"). Machine fields still drive the scheduler.",
          "properties": {
            "type": {
              "type": "string",
              "enum": ["one-time", "recurring"]
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
              "enum": ["hourly", "daily", "weekly", "custom"]
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
              "description": "Natural-language schedule shown in the UI (list + confirm). Use the user's language. Examples: \"Every weekday at 9:00 AM\", \"每天上午 9 点\", \"Once on May 1 at 3pm\". Required for create."
            }
          },
          "required": ["type", "summary"],
          "additionalProperties": false
        },
        "agentConfig": {
          "type": "object",
          "description": "Harness + model for the automation run. type is required (claude|codex|acp|opencode). Defaults on create: claude + bypassPermissions + sandbox off. Prefer unified fields: model, effort, permissionMode, sandboxMode, apiProviderId, acpAgentId.",
          "properties": {
            "type": {
              "type": "string",
              "enum": ["claude", "codex", "acp", "opencode"]
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
              "enum": ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk", "auto", "agent"],
              "description": "Unified permission mode. Prefer bypassPermissions for unattended runs."
            },
            "sandboxMode": {
              "type": "string",
              "enum": ["off", "on", "auto"],
              "description": "Claude sandbox (ignored by other harnesses)."
            },
            "apiProviderId": {
              "type": ["string", "null"],
              "description": "Optional third-party AI provider credential id (claude/codex)."
            },
            "acpAgentId": {
              "type": "string",
              "description": "ACP only: agent id (e.g. grok-build)."
            },
            "reasoningEffort": {
              "type": "string",
              "enum": ["minimal", "low", "medium", "high", "xhigh"],
              "description": "Codex legacy alias for effort."
            },
            "permissionPreset": {
              "type": "string",
              "enum": ["read-only", "default", "auto-review", "full-access"],
              "description": "Codex legacy alias for permissionMode (full-access ≈ bypassPermissions)."
            }
          },
          "required": ["type"],
          "additionalProperties": false
        }
      },
      "required": ["action"],
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
    "name": "device_snapshot",
    "description": "Capture the phone/tablet screen and return a stateId that later calls must quote. mode=semantic (default) returns the accessibility tree with @eN refs, labels, identifiers and bounds — prefer it: refs survive animation and rotation, coordinates do not. mode=visual saves a PNG and returns image.path (not pixels); call Read on that path only if you need to look. mode=fused returns both. Waits for the screen to stop animating first; settled=false means it was still moving, so treat the geometry as approximate. Re-snapshot after anything that changes the screen — refs are positional and a stale stateId is rejected by device_act.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": deviceDescriptionProperty,
        "mode": { "description": "Default semantic", "type": "string", "enum": ["semantic", "visual", "fused"] },
        "maxNodes": {
          "description": "Ceiling on tree size. Default 500; truncated=true means the screen has more.",
          "type": "integer",
          "minimum": 1,
          "maximum": 2000
        }
      },
      "required": ["description"],
      "additionalProperties": false
    }
  },
  {
    "name": "device_query",
    "description": "Search or inspect an existing snapshot without re-capturing the device. Use this instead of taking another snapshot when you only need to find an element or read its details — it costs no device round trip and cannot race an animation. op=search matches text against labels, values and identifiers. op=inspect returns one element and its children.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": deviceDescriptionProperty,
        "stateId": { "type": "string", "description": "From a prior device_snapshot." },
        "op": { "type": "string", "enum": ["search", "inspect"] },
        "text": { "description": "For search.", "type": "string" },
        "ref": { "description": "For inspect, e.g. \"@e12\".", "type": "string" }
      },
      "required": ["description", "stateId", "op"],
      "additionalProperties": false
    }
  },
  {
    "name": "device_act",
    "description": "Run 1-10 touch actions against a snapshot, then re-observe to judge whether they worked. Actions: tap, doubleTap, longPress, swipe(direction|toX/toY), pinch(scale), press(ref), type, key, rotate, keyboard. Prefer press for a ref-backed control; it uses accessibility and is immune to animation, rotation and scale. Aim touch actions at refs too; raw x/y is a last resort. The full batch is validated before any action runs. Returns worked|didnt|unknown after re-observing; unknown means input landed but no visible change. Pass expect to define success. A stale stateId is refused before anything happens.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": deviceDescriptionProperty,
        "stateId": { "type": "string" },
        "actions": { "minItems": 1, "maxItems": 10, "type": "array", "items": deviceActionSchema },
        "expect": { "description": "Postcondition checked after the actions run.", ...deviceConditionSchema }
      },
      "required": ["description", "stateId", "actions"],
      "additionalProperties": false
    }
  },
  {
    "name": "device_wait_for",
    "description": "Wait until the screen satisfies a condition. Use this instead of snapshotting in a loop. Distinguishes preexisting (already true when asked) from verified (became true while waiting), so you can tell a real transition from a check that was never going to fail. Returns a fresh settled stateId and matching tree when successful. Target the element by label or identifier, not by ref: refs belong to one snapshot, and what you are waiting for usually does not exist yet.",
    "inputSchema": {
      "type": "object",
      "properties": {
        "description": deviceDescriptionProperty,
        "condition": deviceConditionSchema,
        "timeoutMs": {
          "description": "Default 5000",
          "type": "integer",
          "minimum": 100,
          "maximum": 60000
        }
      },
      "required": ["description", "condition"],
      "additionalProperties": false
    }
  }
] as const

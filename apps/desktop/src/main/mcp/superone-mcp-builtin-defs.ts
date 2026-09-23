import { INTERACTION_MEMORY_TOOL_DEFS } from '@superone/shared/interaction-memory'
import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import { READ_MANUAL_INPUT_SCHEMA } from './manual-tool-defs'
export { MEDIA_GUIDE_TOPICS, MINIAPP_GUIDE_TOPICS, MANUAL_DOMAINS, PRODUCT_GUIDE_TOPICS, READ_MANUAL_INPUT_SCHEMA, type ManualDomain } from './manual-tool-defs'

// Browser tool name lists live in @superone/shared so registration and
// host-owned auto-approve share one source of truth (spread into BUILT_IN).
export {
  BROWSER_PRIMITIVE_TOOL_NAMES,
  BROWSER_ACTION_TOOL_NAMES,
  BROWSER_LEGACY_TOOL_NAMES,
  BROWSER_COMPACT_TOOL_NAMES,
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  type BuiltInSuperoneToolName,
} from '@superone/shared/superone-host-owned-tools'

export const SESSION_ARCHIVE_TOOL_NAMES = [
  'project_list',
  'session_list',
  'session_search',
  'session_read',
  'session_cleanup',
  'session_tag',
  'session_tag_list',
] as const

export { TERMINAL_TOOL_NAMES } from '@superone/shared/superone-host-owned-tools'

export const AUTOMATION_TOOL_NAMES = [
  'automation_list',
  'automation_apply',
  'automation_delete',
] as const

export const SESSION_COLLABORATION_TOOL_NAMES = [
  'session_collab_list_agents',
  'session_collab_request',
  'session_collab_start',
  'session_collab_send',
  'session_collab_retrieve',
] as const

export const CONFIG_SETTINGS_DOMAINS = [
  'general',
  'appearance',
  'browser',
  'computer-use',
  'agent-claude',
  'agent-codex',
  'ai-provider',
  'custom-platform',
] as const

import {
  MANUAL_READ_DESCRIPTION,
  SETUP_MINI_APP_DEV_DESCRIPTION,
  REGISTER_DEV_MINIAPP_DESCRIPTION,
  PACK_MINI_APP_DESCRIPTION,
  UPDATE_SUPERONE_TYPES_DESCRIPTION,
  RENAME_SESSION_DESCRIPTION,
  SESSION_TAG_DESCRIPTION,
  SESSION_TAG_LIST_DESCRIPTION,
  PROJECT_LIST_DESCRIPTION,
  SESSION_LIST_DESCRIPTION,
  SESSION_SEARCH_DESCRIPTION,
  SESSION_READ_DESCRIPTION,
  SESSION_TAGS_FILTER_DESCRIPTION,
  SESSION_TAG_MATCH_DESCRIPTION,
  SESSION_CLEANUP_DESCRIPTION,
  CONFIG_READ_DESCRIPTION,
  CONFIG_APPLY_DESCRIPTION,
  LIST_MEDIA_PROVIDERS_DESCRIPTION,
  GENERATE_IMAGE_DESCRIPTION,
  GENERATE_VIDEO_DESCRIPTION,
  VIDEO_STATUS_DESCRIPTION,
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
  START_LAUNCH_ID_DESCRIPTION,
  SESSION_SEND_DESCRIPTION,
  SESSION_SEND_TO_DESCRIPTION,
  SESSION_SEND_CONTENT_DESCRIPTION,
  SESSION_RETRIEVE_DESCRIPTION,
  SESSION_RETRIEVE_FROM_DESCRIPTION,
  AUTOMATION_LIST_DESCRIPTION,
  AUTOMATION_APPLY_DESCRIPTION,
  AUTOMATION_DELETE_DESCRIPTION,
} from '@superone/shared/superone-tool-descriptions'
import { HOST_ACTION_TERMINAL_DESCRIPTORS } from '@superone/shared/environment/host-action-terminal-descriptors'
export * from '@superone/shared/superone-tool-descriptions'

/** Shared nested schedule schema for automation_apply (JSON Schema + host-action). */
export const AUTOMATION_SCHEDULE_INPUT_SCHEMA = {
  type: 'object',
  description:
    'When to run. one-time needs runAt (ISO); recurring needs cron. Always include summary. '
    + 'Preset fields and examples: read_manual({ domain: "product", topic: "automation" }).',
  properties: {
    type: { type: 'string', enum: ['one-time', 'recurring'] },
    cron: { type: 'string', description: 'Cron expression for recurring (required when type=recurring).' },
    runAt: { type: 'string', description: 'ISO timestamp for one-time (required when type=one-time).' },
    preset: { type: 'string', enum: ['hourly', 'daily', 'weekly', 'custom'] },
    timeOfDay: { type: 'string', description: 'HH:mm local time hint for daily/weekly presets.' },
    dayOfWeek: {
      type: 'array',
      items: { type: 'integer', minimum: 0, maximum: 6 },
      description: '0=Sun … 6=Sat for weekly preset.',
    },
    minuteOfHour: { type: 'integer', minimum: 0, maximum: 59, description: 'Minute for hourly preset.' },
    summary: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description:
        'Natural-language schedule shown in the list and confirm dialog, in the user\'s language '
        + '(e.g. "Every weekday at 9:00 AM"). Required for create.',
    },
  },
  required: ['type', 'summary'],
  additionalProperties: false,
} as const

export const AUTOMATION_AGENT_CONFIG_INPUT_SCHEMA = {
  type: 'object',
  description:
    'Harness for the run; only type is required. Create defaults to claude + bypassPermissions. ' +
    'Field-by-field: read_manual({ domain: "product", topic: "automation" }).',
  properties: {
    type: { type: 'string', enum: ['claude', 'codex', 'acp', 'opencode'] },
    agentName: { type: 'string', description: 'Claude only: named agent profile.' },
    model: { type: 'string' },
    effort: {
      type: 'string',
      description: 'Unified effort (Claude levels, Codex reasoning, ACP mode ids).',
    },
    permissionMode: {
      type: 'string',
      enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'agent'],
      description: 'Unified permission mode. Prefer bypassPermissions for unattended runs.',
    },
    sandboxMode: { type: 'string', enum: ['off', 'on', 'auto'], description: 'Claude sandbox (ignored by other harnesses).' },
    apiProviderId: {
      type: ['string', 'null'],
      description: 'Optional third-party AI provider credential id (claude/codex).',
    },
    acpAgentId: { type: 'string', description: 'ACP only: agent id (e.g. grok-build).' },
    reasoningEffort: {
      type: 'string',
      enum: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'],
      description: 'Codex legacy alias for effort.',
    },
    permissionPreset: {
      type: 'string',
      enum: ['read-only', 'default', 'auto-review', 'full-access'],
      description: 'Codex legacy alias for permissionMode (full-access ≈ bypassPermissions).',
    },
  },
  required: ['type'],
  additionalProperties: false,
} as const

export const BUILT_IN_SUPERONE_TOOL_DEFS: SuperoneMcpToolDescriptor[] = [
  ...INTERACTION_MEMORY_TOOL_DEFS,
  {
    name: 'session_collab_list_agents',
    description: SESSION_LIST_AGENTS_DESCRIPTION,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'session_collab_request',
    description: SESSION_REQUEST_AGENTS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        launches: {
          type: 'array',
          minItems: 1,
          maxItems: 16,
          items: {
            type: 'object',
            properties: {
              launchId: { type: 'string', description: 'Optional caller correlation id.' },
              mode: {
                type: 'string',
                enum: ['spawn', 'handoff', 'link'],
                description: LAUNCH_MODE_DESCRIPTION,
              },
              sessionId: {
                type: 'string',
                minLength: 1,
                description: LAUNCH_SESSION_ID_DESCRIPTION,
              },
              agentId: {
                type: 'string',
                description: 'Agent profile id from session_collab_list_agents. Required for mode "spawn" and "handoff"; omit for "link".',
              },
              summary: {
                type: 'string',
                minLength: 1,
                description: LAUNCH_SUMMARY_DESCRIPTION,
              },
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                description: 'Spawn/handoff: human-friendly session label (e.g. "Alice"). Link: optional; defaults to peer session title.',
              },
              role: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                description: 'Spawn/handoff: role for title "Name - Role". Link: optional; defaults to "Peer".',
              },
              config: {
                type: 'object',
                description: 'Spawn and handoff only. Ignored for mode "link".',
                properties: {
                  model: { type: 'string' },
                  effort: { type: 'string' },
                  fastMode: {
                    type: 'boolean',
                    description: 'Codex only. Enable the selected model\'s Fast service tier for this agent session.',
                  },
                  apiProviderId: { type: ['string', 'null'] },
                  permissionMode: {
                    type: 'string',
                    enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto', 'agent'],
                    description: LAUNCH_PERMISSION_MODE_DESCRIPTION,
                  },
                  sandboxMode: { type: 'string', enum: ['off', 'on', 'auto'] },
                  cwd: { type: 'string', description: LAUNCH_CWD_DESCRIPTION },
                  worktree: {
                    type: 'object',
                    description: LAUNCH_WORKTREE_DESCRIPTION,
                    properties: {
                      enabled: { type: 'boolean' },
                      baseBranch: { type: 'string' },
                      mode: { type: 'string', enum: ['branch', 'attach', 'detach'] },
                      branchName: { type: 'string', description: LAUNCH_BRANCH_NAME_DESCRIPTION },
                      carryLocalChanges: { type: 'boolean' },
                    },
                    required: ['enabled', 'baseBranch', 'mode'],
                    additionalProperties: false,
                  },
                  harnessConfig: { type: 'object' },
                },
                additionalProperties: false,
              },
            },
            required: ['summary'],
            additionalProperties: false,
          },
        },
      },
      required: ['launches'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_collab_start',
    description: SESSION_START_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        launchId: { type: 'string', minLength: 1, description: START_LAUNCH_ID_DESCRIPTION },
        task: { type: 'string', description: LAUNCH_TASK_DESCRIPTION },
      },
      required: ['launchId'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_collab_send',
    description: SESSION_SEND_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: SESSION_SEND_TO_DESCRIPTION },
        content: { type: 'string', maxLength: 100000, description: SESSION_SEND_CONTENT_DESCRIPTION },
        clientMessageId: { type: 'string' },
      },
      required: ['content'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_collab_retrieve',
    description: SESSION_RETRIEVE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'array', maxItems: 32, items: { type: 'string' }, description: SESSION_RETRIEVE_FROM_DESCRIPTION },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'read_manual',
    description: MANUAL_READ_DESCRIPTION,
    inputSchema: READ_MANUAL_INPUT_SCHEMA,
    _meta: { 'anthropic/alwaysLoad': true },
  },
  {
    name: 'config_read',
    description: CONFIG_READ_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          enum: CONFIG_SETTINGS_DOMAINS,
          description: 'Which settings domain to read. Omit to list all domains with their descriptions.',
        },
        recordId: {
          type: 'string',
          description: 'Resource domains only: read one record\'s full current values instead of the record list.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'config_apply',
    description: CONFIG_APPLY_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        changes: {
          type: 'array',
          description: 'Scalar settings changes to propose. Each item targets one field key from config_read. Mutually exclusive with `resource`.',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'The settings field key, exactly as returned by config_read.' },
              value: {
                type: ['string', 'number', 'boolean', 'null'],
                description: 'The new value. Use null (or "") to reset a clearable field to its default.',
              },
            },
            required: ['key', 'value'],
            additionalProperties: false,
          },
        },
        resource: {
          type: 'object',
          description: 'A resource create/update/delete to propose, e.g. resource:"ai-provider". Mutually exclusive with `changes`.',
          properties: {
            resource: { type: 'string', description: 'The resource domain, e.g. "ai-provider" — as returned by config_read.' },
            operation: { type: 'string', enum: ['create', 'update', 'delete'], description: 'Which operation to perform.' },
            recordId: { type: 'string', description: 'The record\'s `id` (from config_read). Required for update/delete.' },
            values: {
              type: 'object',
              description: 'Field values keyed by field key, using the field keys/types from config_read. Required for create (all required fields) and update (only the fields being changed).',
            },
          },
          required: ['resource', 'operation'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_setup',
    description: SETUP_MINI_APP_DEV_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the mini-app' },
        slug: { type: 'string', description: 'URL-safe lowercase identifier (e.g. "weather-app"). Used to build the appId. Must be lowercase alphanumeric with hyphens.' },
        directory: { type: 'string', description: 'Absolute path to the directory where the mini-app source will be scaffolded. For scope="project", this MUST be inside projectDir (e.g. <projectDir>/packages/my-app or <projectDir>/tools/dashboard). For scope="user", anywhere on disk (e.g. ~/code/my-tool).' },
        scope: { type: 'string', enum: ['project', 'user'], description: 'project (default): app visible only in the given project; .s1-dev.json is committable. user: app visible across every project on this machine.' },
        projectDir: { type: 'string', description: 'Absolute path to the project directory. Required when scope="project".' },
        template: { type: 'string', enum: ['vanilla', 'react'], description: 'vanilla (default): single index.html, no build needed. react: React + TypeScript + Tailwind, requires `bun run build` after scaffold.' },
        description: { type: 'string', description: 'Short description of what the app does' },
      },
      required: ['name', 'slug', 'directory'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_register',
    description: REGISTER_DEV_MINIAPP_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Absolute path to the existing mini-app source directory. Must contain a manifest.json at the root or under dist/.' },
        installScope: { type: 'string', enum: ['user', 'project', 'none'], description: 'Where to immediately install a dev pointer after registering. "none" (default) just registers; user can install later via Settings → Apps → Library.' },
        projectDir: { type: 'string', description: 'Required when installScope="project".' },
        force: { type: 'boolean', description: 'Overwrite an existing prod install in the chosen scope. Default false.' },
        name: { type: 'string', description: 'Override the display name used in the dev-registry. Defaults to manifest.name.' },
      },
      required: ['directory'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_pack',
    description: PACK_MINI_APP_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'Absolute path to the mini-app directory containing manifest.json' },
        outputDir: { type: 'string', description: 'Absolute path to the directory where the .s1app file will be written' },
      },
      required: ['appDir', 'outputDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'miniapp_dev_update_types',
    description: UPDATE_SUPERONE_TYPES_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        appDir: { type: 'string', description: 'Absolute path to the mini-app directory' },
      },
      required: ['appDir'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_rename',
    description: RENAME_SESSION_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A concise 4-8 word title describing the current conversation topic.', minLength: 1, maxLength: 80 },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: 'Replace this session\'s tags (set). Pass 1–4 short kebab-case labels you choose, plus issue-N / pr-N when the session targets a tracker item. Reuse names from session_tag_list when they fit; invent when they don\'t. Empty array clears. Applied even when the title is user_locked.',
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_tag',
    description: SESSION_TAG_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          description: 'One session to tag. Default: current. Mutually exclusive with sessionIds.',
        },
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 50,
          description: 'Bulk target ids (max 50). add required; set/remove not allowed. Mutually exclusive with sessionId.',
        },
        add: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: 'Tags to add (normalized, de-duped). Mutually exclusive with remove/set.',
        },
        remove: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: 'Tags to remove. Mutually exclusive with add/set.',
        },
        set: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: 'Replace all tags. Empty array clears. Mutually exclusive with add/remove.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'session_tag_list',
    description: SESSION_TAG_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring filter on tag name.' },
        kind: {
          type: 'string',
          enum: ['label', 'ref', 'all'],
          description: 'label (default) = topic labels; ref = issue-N / pr-N references; all = both.',
        },
        includeHidden: { type: 'boolean', description: 'Count hidden sessions. Default false.' },
        projectId: {
          type: 'string',
          description: 'List tags in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project.',
        },
        allProjects: {
          type: 'boolean',
          description: 'List tags across every SuperOne project. Mutually exclusive with projectId. Default false.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows. Default 50, max 100.' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'project_list',
    description: PROJECT_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring filter on project name or path.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows. Default 50, max 100.' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'session_list',
    description: SESSION_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive title substring filter.' },
        harness: { type: 'string', enum: ['claude', 'codex', 'acp', 'opencode'], description: 'Filter by harness.' },
        includeHidden: { type: 'boolean', description: 'Include hidden sessions. Default false.' },
        includePinnedOnly: { type: 'boolean', description: 'Only pinned sessions. Default false.' },
        parentOnly: { type: 'boolean', description: 'Exclude collab child sessions. Default false.' },
        olderThan: { type: 'string', description: 'ISO timestamp — only sessions last active before this.' },
        newerThan: { type: 'string', description: 'ISO timestamp — only sessions last active after this.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: SESSION_TAGS_FILTER_DESCRIPTION,
        },
        tagMatch: {
          type: 'string',
          enum: ['any', 'all'],
          description: SESSION_TAG_MATCH_DESCRIPTION,
        },
        projectId: {
          type: 'string',
          description: 'List sessions in this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project.',
        },
        allProjects: {
          type: 'boolean',
          description: 'List sessions across every SuperOne project. Mutually exclusive with projectId. Default false.',
        },
        order: {
          type: 'string',
          enum: [
            'last_active_desc',
            'last_active_asc',
            'created_desc',
            'created_asc',
            'message_count_desc',
            'message_count_asc',
            'size_desc',
            'size_asc',
          ],
          description:
            'Sort order. Default last_active_desc. last_active_asc = oldest first. created_* by createdAt; message_count_* by message count; size_* ranks by approx transcript size and includes sizeBytes (character length of message JSON, not disk page-file bytes).',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max rows. Default 20, max 50.' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'session_search',
    description: SESSION_SEARCH_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, description: 'Search terms (AND). Matches title and message text.' },
        harness: { type: 'string', enum: ['claude', 'codex', 'acp', 'opencode'] },
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 32,
          description: 'Optional: restrict search to these session ids.',
        },
        role: { type: 'string', enum: ['user', 'assistant', 'any'], description: 'Message role filter. Default any.' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 8,
          description: SESSION_TAGS_FILTER_DESCRIPTION,
        },
        tagMatch: {
          type: 'string',
          enum: ['any', 'all'],
          description: SESSION_TAG_MATCH_DESCRIPTION,
        },
        projectId: {
          type: 'string',
          description: 'Search this SuperOne project id only (from project_list). Mutually exclusive with allProjects. Default: current project.',
        },
        allProjects: {
          type: 'boolean',
          description: 'Search every SuperOne project. Mutually exclusive with projectId. Default false.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max hits. Default 20, max 50.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_read',
    description: SESSION_READ_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: {
          type: 'string',
          minLength: 1,
          description: 'Target SuperOne session id from session_list or session_search (any project). Do not pass the current session.',
        },
        view: {
          type: 'string',
          enum: ['meta', 'user', 'assistant', 'text', 'tools', 'tool_detail'],
          description:
            'meta=metadata; user=user text only; assistant=assistant text + toolCount; text=both; tools=tool index; tool_detail=one tool (needs toolUseId). Default text.',
        },
        messageId: { type: 'string', description: 'Anchor page at this message id (from search or a prior read).' },
        around: {
          type: 'integer',
          minimum: 0,
          maximum: 50,
          description: 'With messageId: include this many messages before and after on the global timeline.',
        },
        cursor: {
          type: ['integer', 'null'],
          description: 'Exclusive end index for the next older page (from a prior read). Omit for newest page.',
        },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Max messages this page. Default 20, max 50.' },
        includeThinking: { type: 'boolean', description: 'Include thinking blocks in text views. Default false.' },
        toolUseId: { type: 'string', description: 'Required for view=tool_detail.' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_cleanup',
    description: SESSION_CLEANUP_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['hide', 'unhide', 'delete'],
          description: 'hide/unhide soft-archive (no confirm). delete permanently removes after user approval dialog.',
        },
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 50,
          description: 'Session ids from session_list to act on.',
        },
        includePinned: { type: 'boolean', description: 'Allow acting on pinned sessions. Default false (pinned are skipped).' },
        maxDelete: { type: 'integer', minimum: 1, maximum: 50, description: 'Hard cap on sessions acted on. Default 50.' },
      },
      required: ['action', 'sessionIds'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation_list',
    description: AUTOMATION_LIST_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'When set, return full detail for this automation (must belong to the current project).',
        },
        enabled: { type: 'boolean', description: 'Filter by enabled state. Omit for all.' },
        query: { type: 'string', description: 'Case-insensitive name substring filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max rows. Default 50, max 100.' },
        offset: { type: 'integer', minimum: 0, description: 'Pagination offset. Default 0.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'automation_apply',
    description: AUTOMATION_APPLY_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update'],
          description: 'create a new automation, or update an existing one (including toggle enabled).',
        },
        id: {
          type: 'string',
          description: 'Required for update. Automation id from automation_list.',
        },
        name: { type: 'string', description: 'Display name. Required for create; optional for update.' },
        prompt: {
          type: 'string',
          description: 'Prompt sent to the agent when the automation runs. Required for create; optional for update.',
        },
        enabled: {
          type: 'boolean',
          description: 'Whether the scheduler will run this automation. Create defaults to true; use false to pause.',
        },
        schedule: AUTOMATION_SCHEDULE_INPUT_SCHEMA,
        agentConfig: AUTOMATION_AGENT_CONFIG_INPUT_SCHEMA,
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'automation_delete',
    description: AUTOMATION_DELETE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 20,
          description: 'Automation ids from automation_list to delete (current project only).',
        },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_list_providers',
    description: LIST_MEDIA_PROVIDERS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', enum: ['image', 'video'], description: 'Filter by media category. Omit to list all usable providers.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'media_generate_image',
    description: GENERATE_IMAGE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A detailed description of the image to generate, or the edit to apply when reference images are provided.' },
        provider: { type: 'string', description: 'Which configured image provider id to use. Call media_list_providers to discover ids. Defaults to the first usable provider.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's default model." },
        aspect_ratio: { type: 'string', description: 'Aspect ratio like "16:9" or "1:1". Preferred for google models.' },
        size: {
          type: 'string',
          description:
            'Size for the image. OpenAI: pixel size like "1024x1024". Ark: "2K"/"4K" or "WxH". Google Gemini image models: resolution tier "1K"/"2K"/"4K" (or "512"); pair with aspect_ratio. Check media_list_providers sizeNote.',
        },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to input images for editing / image-to-image / iterating on a prior result. Omit for pure text-to-image.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_generate_video',
    description: GENERATE_VIDEO_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'A detailed description of the video to generate, including motion and camera direction.' },
        provider: { type: 'string', description: 'Which configured video provider id to use. Call media_list_providers with category "video" to discover ids. Defaults to the first usable provider.' },
        model: { type: 'string', description: "Model id override. Defaults to the provider's default video model." },
        first_frame_path: { type: 'string', description: 'Absolute path to an image to animate from (image-to-video). This is the starting frame.' },
        last_frame_path: { type: 'string', description: 'Absolute path to an image the video should end on. Requires first_frame_path.' },
        reference_image_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference images for character or scene consistency. Up to 9 images total across all roles on Ark.' },
        reference_video_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference video clips. Volcengine Ark (Seedance) only; ignored by other providers.' },
        reference_audio_paths: { type: 'array', items: { type: 'string' }, description: 'Absolute paths to reference audio tracks. Volcengine Ark (Seedance) only; ignored by other providers.' },
        aspect_ratio: { type: 'string', description: 'Aspect ratio like "16:9", "9:16" or "1:1".' },
        resolution: { type: 'string', description: 'Pixel resolution like "1920x1080" or "1280x720". Ark maps this onto its 480p/720p/1080p tiers; Sora accepts only 720x1280, 1280x720, 1024x1792, 1792x1024.' },
        duration: { type: 'number', description: 'Clip length in seconds. Ark accepts 2-15; Sora accepts only 4, 8 or 12.' },
        fps: { type: 'number', description: 'Frames per second, e.g. 24. Ignored by providers that derive it from the model.' },
        seed: { type: 'number', description: 'Seed for reproducible generation.' },
        generate_audio: { type: 'boolean', description: 'Whether the model should generate a soundtrack alongside the video, where supported.' },
        watermark: { type: 'boolean', description: 'Whether to stamp the provider watermark. Volcengine Ark only.' },
        camera_fixed: { type: 'boolean', description: 'Lock the camera in place instead of letting the model move it. Volcengine Ark only.' },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
  },
  {
    name: 'media_video_status',
    description: VIDEO_STATUS_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        generation_id: { type: 'string', description: 'The generationId returned by media_generate_video.' },
      },
      required: ['generation_id'],
      additionalProperties: false,
    },
  },
  ...HOST_ACTION_TERMINAL_DESCRIPTORS,
]

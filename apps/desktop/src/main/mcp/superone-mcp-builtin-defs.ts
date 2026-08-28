import type { SuperoneMcpToolDescriptor } from './superone-mcp-types'
import { WIDGET_GUIDELINE_MODULES } from '../generative-ui/guideline-modules'

export const MEDIA_GUIDE_TOPICS = [
  'overview',
  'ark-image',
  'ark-video',
  'openai-image',
  'openai-video',
  'google-image',
  'google-video',
  'newapi-video',
] as const

export const MINIAPP_GUIDE_TOPICS = [
  'overview',
  'manifest',
  'permissions',
  'api-theme',
  'api-locale',
  'api-agent',
  'api-system',
  'api-ui',
  'api-host',
  'packaging',
  'icon',
  'recipes',
  'tools',
] as const

// Browser tool name lists live in @superone/shared so registration and
// host-owned auto-approve share one source of truth (spread into BUILT_IN).
export {
  BROWSER_PRIMITIVE_TOOL_NAMES,
  BROWSER_ACTION_TOOL_NAMES,
  BROWSER_LEGACY_TOOL_NAMES,
  BROWSER_COMPACT_TOOL_NAMES,
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MOBILE_SHARE_FILE_TOOL_NAME,
  type BuiltInSuperoneToolName,
} from '@superone/shared/superone-host-owned-tools'

export const MANUAL_DOMAINS = ['product', 'miniapp', 'media', 'widget'] as const
export type ManualDomain = (typeof MANUAL_DOMAINS)[number]

export const PRODUCT_GUIDE_TOPICS = ['overview', 'contribute', 'debug', 'collaboration', 'sessions', 'automation', 'devices', 'browser'] as const

export const READ_MANUAL_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    domain: {
      type: 'string',
      enum: MANUAL_DOMAINS,
      description: 'Manual domain. Omit to list all domains and their topics.',
    },
    topic: {
      type: 'string',
      description: 'Topic in the selected domain. Pass the domain alone to list valid topics.',
    },
    modules: {
      type: 'array',
      minItems: 1,
      maxItems: WIDGET_GUIDELINE_MODULES.length,
      uniqueItems: true,
      items: { type: 'string', enum: WIDGET_GUIDELINE_MODULES },
      description: 'Widget only: one or more guideline modules. Mutually exclusive with topic.',
    },
  },
  additionalProperties: false,
} as const


export const SESSION_ARCHIVE_TOOL_NAMES = [
  'project_list',
  'session_list',
  'session_search',
  'session_read',
  'session_cleanup',
  'session_tag',
  'session_tag_list',
] as const

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

export const MOBILE_SHARE_FILE_DESCRIPTION =
  'Share a file from the desktop to the mobile device that is currently viewing this session, so the user can open or save it on their phone. ' +
  'This tool is ONLY available while a mobile device is subscribed to the session — if it is not in your tool list, no phone is connected. ' +
  'The file is delivered end-to-end encrypted and appears as a file card in the mobile chat. ' +
  'The path MUST point to a file inside the current project directory. Use it when the user asks to send, share, or get a file onto their phone.'

export const MOBILE_SHARE_FILE_INPUT_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string', description: 'Path to the file to send. Absolute, or relative to the project directory. Must resolve inside the project.' },
    caption: { type: 'string', description: 'Optional short note shown next to the file on the phone.' },
  },
  required: ['path'],
  additionalProperties: false,
} as const

export const MANUAL_READ_DESCRIPTION =
  'Read bundled SuperOne manuals. Omit domain to list all domains; pass domain to list its topics; ' +
  'pass domain with topic to read one topic. For widget, pass either topic or modules, never both. ' +
  // The full topic list is not repeated here: calling this tool with no arguments returns
  // exactly that index. Only the "read X before doing Y" triggers stay, because those are
  // the ones a model cannot discover after the fact — by then it has already acted.
  'Read product/collaboration before session_collab_request, product/automation before automation_apply, ' +
  'product/devices before device_request_control, product/browser before saving a browser action, ' +
  'miniapp/overview before mini-app development, and media/overview before provider-specific options. ' +
  'Use config_read for live settings and widget_list_templates for saved widgets.'

export const MINIAPP_GUIDE_TOPIC_DESCRIPTION =
  'Read overview first, then choose the narrowest topic needed for the current implementation step.'

export const SETUP_MINI_APP_DEV_DESCRIPTION =
  'Scaffold and register a new mini-app after reading miniapp/overview and confirming its requirements, template, tools, directory, and scope with the user. ' +
  'The tool creates source files, updates ~/.superone/dev-registry.json, and writes a project- or user-scoped .s1-dev.json pointer. ' +
  'Use miniapp_dev_register instead when source files already exist.'

export const REGISTER_DEV_MINIAPP_DESCRIPTION =
  'Register an existing mini-app directory without modifying its source files. ' +
  'Reads manifest.json from the directory or dist, updates ~/.superone/dev-registry.json, and optionally writes a project- or user-scoped .s1-dev.json pointer.'

export const PACK_MINI_APP_DESCRIPTION =
  'Package a mini-app directory into a .s1app file for distribution. The app directory must contain a valid manifest.json with a version field. Generates integrity checksums and creates a compressed archive.'

export const UPDATE_SUPERONE_TYPES_DESCRIPTION =
  'Update the superone.d.ts type definitions in an existing mini-app project to the latest version. Use this when the mini-app needs access to newly added SuperOne APIs.'

export const RENAME_SESSION_DESCRIPTION =
  'Rename the current chat session to a concise topic label shown in the sidebar. ' +
  'Always pass tags (set): 1–4 short kebab-case labels you choose so session_list/session_search can find this chat. ' +
  'Reuse names from session_tag_list when they fit; invent one when they don\'t. ' +
  // The user_locked recovery path is not described here: the error reply itself already
  // says "Do not call session_rename again for this session", so spelling it out in the
  // always-loaded surface charged every turn for advice only one reply ever needs.
  'Top-level agent only — a Task/subagent worker does not own the user-facing title and must not call it.'

export const SESSION_TAG_DESCRIPTION =
  'Tag SuperOne sessions so session_list/session_search can filter by tag. Default: current session. ' +
  'Pass sessionId for one other session, or sessionIds with add to tag many. Use add, remove, or set (exactly one). set: [] clears. ' +
  'Pick 1–4 short kebab-case labels; reuse names from session_tag_list when they fit, otherwise invent. ' +
  'Only the top-level agent may call this; subagents must not. Not session_rename (titles) and not live collab.'

export const SESSION_TAG_LIST_DESCRIPTION =
  'List tags used on SuperOne sessions (tag + session count). Default: current project; projectId or allProjects for other scope. ' +
  'Filter with query (tag substring). Hidden sessions omitted unless includeHidden. ' +
  'Call this before session_list/session_search with tags. Then filter with tags + tagMatch any (at least one) or all (every tag). Not live collab.'

export const PROJECT_LIST_DESCRIPTION =
  'List SuperOne projects (id, name, path, lastActiveAt). ' +
  'Call this to discover projectId before session_list/session_search with projectId. ' +
  'Default order is last-active desc. Filter with query (name/path substring). ' +
  'isCurrent marks the project of the calling session.'

export const SESSION_LIST_DESCRIPTION =
  'List SuperOne sessions (metadata only). Default: current project. ' +
  'Pass projectId (from project_list) or allProjects=true. Rows include projectId only — use project_list for path/name. ' +
  'Filter by title query, harness, pin/hidden, dates or tags (discover them with session_tag_list). ' +
  'Use before session_read/session_search. Not live collab or harness resume.'

export const SESSION_SEARCH_DESCRIPTION =
  'Search SuperOne chat transcripts by text (title + message body). Default: current project; projectId or allProjects for cross-project. ' +
  'Optional tags + tagMatch (any/all, default any) narrows sessions in SQL before scanning messages. Discover tags with session_tag_list. ' +
  'Returns matching message hits with short snippets and projectId. Then call session_read with sessionId/messageId. Snippets are pointers only — not full bodies.'

export const SESSION_READ_DESCRIPTION =
  'Read another SuperOne session\'s saved transcript by id (any project; harness-agnostic; does not resume provider threads). ' +
  'Do not read the current session — it is already in your context. ' +
  'Views: meta | user | assistant | text | tools | tool_detail. user/assistant/text are pure conversation (no tool lines; assistant/text include toolCount). ' +
  'tools = index; tool_detail needs toolUseId. Paginate with limit/cursor; anchor with messageId/around. Prefer user then on-demand assistant/tools. meta includes projectId and tags.'

export const SESSION_TAGS_FILTER_DESCRIPTION =
  'Tags from session_tag_list. Filter sessions that have these labels.'

export const SESSION_TAG_MATCH_DESCRIPTION =
  'any = at least one listed tag (default). all = every listed tag. Ignored when tags is omitted.'

export const SESSION_CLEANUP_DESCRIPTION =
  'Hide, unhide, or delete SuperOne sessions by id (from session_list; ids may be from any project). ' +
  'hide/unhide need no confirmation. delete always opens a user confirmation dialog. ' +
  'Never deletes the current session; skips pinned unless includePinned. Prefer session_list to choose ids first.'

export const CONFIG_READ_DESCRIPTION =
  'Read live SuperOne settings and their field schema. Always call this before config_apply. ' +
  'Omit domain to list settings and resource domains; pass domain to read exact keys, current values, and constraints. ' +
  'For resource domains, pass recordId to read one record before updating or deleting it. Use read_manual for documentation.'

export const CONFIG_APPLY_DESCRIPTION =
  'Propose a settings change or resource create/update/delete using keys returned by config_read. ' +
  'Pass exactly one of changes or resource. Every call opens an editable confirmation dialog and applies nothing without user approval. ' +
  'For updates, send only changed fields. Stop on cancelled or error; on rejected, use the returned feedback before retrying.'

export const MEDIA_GUIDE_TOPIC_DESCRIPTION =
  'Read overview first, then choose the provider-task topic matching media_list_providers.kind and the requested media type.'

export const LIST_MEDIA_PROVIDERS_DESCRIPTION =
  'List configured media providers that have usable credentials. Filter by image or video. ' +
  'Use a returned provider id with media_generate_image or media_generate_video; use kind to select the matching media manual topic. ' +
  'Honor returned sizing and sizeNote constraints.'

export const GENERATE_IMAGE_DESCRIPTION =
  'Generate or edit an image. For edits, pass source files in reference_image_paths. ' +
  'The result is displayed automatically; do not embed it again. Inspect previewPaths only, because savedPaths contains full-resolution originals for export or follow-up edits. ' +
  'Before provider-specific options, call media_list_providers and read media/overview plus the matching provider topic. Check result warnings for ignored options.'

export const GENERATE_VIDEO_DESCRIPTION =
  'Submit an asynchronous video generation after the user reviews its parameters. Stop on cancelled or error; use feedback before retrying. ' +
  'Poll media_video_status about every 30s until generated or error. The finished video is displayed automatically — do not embed it again. ' +
  'For provider options call media_list_providers(category:"video"), then read media/overview and the matching provider topic.'

export const VIDEO_STATUS_DESCRIPTION =
  'Check on a video generation started by media_generate_video. ' +
  'Returns `{status:"running"}` while it renders, `{status:"generated", savedPaths:[...]}` when finished, or `{status:"error", message}` if it failed. ' +
  'Each call asks the provider directly and is what advances the job, so polling is required rather than cosmetic: without it the video is never downloaded or saved. ' +
  'Poll roughly every 30 seconds while it is running. Do not tell the user the video is ready until this returns `generated`.'

export const SESSION_LIST_AGENTS_DESCRIPTION =
  'List the agent profiles available for user-approved child sessions. Only launchable agents are returned. ' +
  'Inspect each profile\'s harness and defaultConfig before session_collab_request. ' +
  'You may reuse one agentId for multiple launches. ' +
  'Skip this call when the user already named an agent with @ — that mention carries its agentId.'

export const SESSION_REQUEST_AGENTS_DESCRIPTION =
  'Request user approval for collaboration launches. See the mode field for spawn vs handoff vs link. ' +
  'Spawn/handoff: pick an agentId from session_collab_list_agents; require name, role, summary, task. Link: require sessionId + summary. ' +
  'Read read_manual({ domain: "product", topic: "collaboration" }) before the first launch in a session. ' +
  'User must approve; returns the credential for session_collab_start.'

export const LAUNCH_SUMMARY_DESCRIPTION =
  'Short 2–3 sentence task summary shown collapsed in the confirm dialog. Not the full brief — put detail in task.'

export const LAUNCH_TASK_DESCRIPTION =
  'Full Markdown brief. Spawn/handoff: delivered to the new session on session_collab_start. ' +
  'A handoff receiver cannot ask you anything back, so make the brief self-contained. ' +
  'Link: optional opening for the peer (mailbox + turn wake, never system prompt). Expandable in the confirm UI.'

export const LAUNCH_MODE_DESCRIPTION =
  '"spawn" (default) = nested child with a two-way mailbox. ' +
  '"handoff" = top-level sibling, not nested: it owns the task from then on, with no mailbox and no reply — pass work forward rather than supervise it. ' +
  '"link" = connect to an existing session (sessionId required).'

export const LAUNCH_SESSION_ID_DESCRIPTION =
  'Existing SuperOne session id to link with (mode "link" only). Required for link; ignore for spawn. Prefer ids from @session mentions or session_list — never invent ids.'

/**
 * Field-level guidance, not part of the tool description: `session_collab_request`
 * is an always-visible built-in and its description is on a 700-char budget, but
 * the input schema is only read when the model actually fills the field in.
 * Both registration surfaces (JSON Schema for the Codex stdio bridge, Zod for the
 * in-process Claude server) must carry it — see superone-mcp-builtin-defs.test.ts.
 *
 * Long worktree/cwd recipes live in product/collaboration via read_manual — keep
 * field blurbs short and point there.
 */
export const LAUNCH_PERMISSION_MODE_DESCRIPTION =
  'How autonomous the child session is. Nobody watches a child, so prefer the most autonomous mode it can finish under; "plan"/"default" only when stopping for human review is the point. ' +
  'Per-harness mode names, and why requesting autonomy is safe here: See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_CWD_DESCRIPTION =
  'Only for a genuinely different project root; omit for the current project. ' +
  'Never a same-repo worktree leaf — express isolation with config.worktree. ' +
  'See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_WORKTREE_DESCRIPTION =
  'Host-managed worktree for same-repo isolation; leave cwd unset. ' +
  'For parallel implementers, not for read-only review of the shared checkout. ' +
  'See read_manual({ domain: "product", topic: "collaboration" }).'

export const LAUNCH_BRANCH_NAME_DESCRIPTION =
  'With mode "branch", create this unique branch. Git cannot check out one branch in two worktrees.'

export const SESSION_START_DESCRIPTION =
  'Activate one approved collaboration credential. Spawn: create the child and deliver its task. ' +
  'Handoff: create the sibling session and deliver the task; the credential is spent, no mailbox follows. ' +
  'Link: bind the existing peer and wake it via turn injection (not system prompt). ' +
  'Returns when the peer begins or is notified. Retries are idempotent. Start all credentials back-to-back.'

export const SESSION_SEND_DESCRIPTION =
  'Send a persistent Markdown message through one collaboration mailbox (spawn parent-child or link peers). ' +
  'Use clientMessageId for retry-safe delivery. The host wakes the peer and later wakes you when it replies. ' +
  'After sending, continue other work or end your turn. Never sleep, resend, or poll session_collab_retrieve while waiting.'

export const SESSION_RETRIEVE_DESCRIPTION =
  'Retrieve queued Markdown messages for this session from one or more collaboration mailboxes. ' +
  'Call after a collaboration wake, or once before acting on peer input. This is a non-blocking read: status "empty" is not a retry signal. ' +
  'Do not sleep or poll; end your turn and wait for the next wake.'

export const AUTOMATION_LIST_DESCRIPTION =
  'List scheduled agent automations for the current project (id, name, enabled, schedule, last/next run). ' +
  'Pass id for full detail (prompt, agentConfig, schedule). Filter with query (name) or enabled. ' +
  'Call before automation_apply or automation_delete. Current project only — not session archive tools.'

export const AUTOMATION_APPLY_DESCRIPTION =
  'Create or update a project automation. create needs name, prompt, schedule; update needs id plus any field (pause via enabled=false). ' +
  'Call automation_list first for ids; remove with automation_delete. Always opens a user confirmation dialog and applies nothing without approval. ' +
  'For schedule and agentConfig shapes see read_manual({ domain: "product", topic: "automation" }).'

export const AUTOMATION_DELETE_DESCRIPTION =
  'Permanently delete project automations by id (from automation_list). ' +
  'Always opens a user confirmation dialog. Current project only. Prefer automation_list to choose ids first.'

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
              task: {
                type: 'string',
                description: LAUNCH_TASK_DESCRIPTION,
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
      properties: { credential: { type: 'string' } },
      required: ['credential'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_collab_send',
    description: SESSION_SEND_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        credential: { type: 'string' },
        content: {
          type: 'string',
          maxLength: 100000,
          description:
            'Mailbox message body in Markdown. Prefer structured Markdown (headings, lists, code fences) for agent-to-agent handoffs; the SuperOne UI renders it as a Markdown preview.',
        },
        clientMessageId: { type: 'string' },
      },
      required: ['credential', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'session_collab_retrieve',
    description: SESSION_RETRIEVE_DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        credentials: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'string' } },
      },
      required: ['credentials'],
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
          description: 'Replace this session\'s tags (set). Pass 1–4 short kebab-case labels you choose. Reuse names from session_tag_list when they fit; invent when they don\'t. Empty array clears. Applied even when the title is user_locked.',
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
]

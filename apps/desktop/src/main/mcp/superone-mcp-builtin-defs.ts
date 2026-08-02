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
  'api-fs',
  'api-git',
  'api-db',
  'api-kv',
  'api-peer',
  'api-theme',
  'api-locale',
  'api-agent',
  'api-system',
  'api-ui',
  'api-worker',
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
  BROWSER_TOOL_NAMES,
  BUILT_IN_SUPERONE_TOOL_NAMES,
  MOBILE_SHARE_FILE_TOOL_NAME,
  type BuiltInSuperoneToolName,
} from '@superone/shared/superone-host-owned-tools'

export const MANUAL_DOMAINS = ['product', 'miniapp', 'media', 'widget'] as const
export type ManualDomain = (typeof MANUAL_DOMAINS)[number]

export const PRODUCT_GUIDE_TOPICS = ['overview', 'debug'] as const

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
  'Use product/debug for support and runtime paths, miniapp/overview before mini-app development, ' +
  'and media/overview before provider-specific options. Use config_read for live settings and ' +
  'widget_list_templates for saved widgets.'

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
  'Rename the current chat session to a concise topic label shown in the sidebar.\n\n' +
  'Only the top-level agent talking directly to the user may call this. If you were launched as a Task/subagent worker, do NOT call it — you do not own the user-facing session title.\n\n' +
  'If the tool returns an error containing "user_locked", the user has manually named this session — do not call session_rename again for this session.'

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
  'Submit an asynchronous video generation after the user reviews its parameters. Stop on cancelled or error; use feedback before retrying a rejected proposal. ' +
  'After submission, poll media_video_status about every 30 seconds until generated or error. The finished video is displayed automatically; do not embed it again. ' +
  'Before provider-specific options, call media_list_providers with category "video" and read media/overview plus the matching provider topic. Check warnings for ignored options.'

export const VIDEO_STATUS_DESCRIPTION =
  'Check on a video generation started by media_generate_video. ' +
  'Returns `{status:"running"}` while it renders, `{status:"generated", savedPaths:[...]}` when finished, or `{status:"error", message}` if it failed. ' +
  'Each call asks the provider directly and is what advances the job, so polling is required rather than cosmetic: without it the video is never downloaded or saved. ' +
  'Poll roughly every 30 seconds while it is running. Do not tell the user the video is ready until this returns `generated`.'

export const SESSION_LIST_AGENTS_DESCRIPTION =
  'List the built-in agent profiles (harness + config) available for user-approved child sessions. ' +
  'Each profile includes defaultConfig with the model/effort inherited when a request omits them. ' +
  'Call this before session_collab_request. The same profile may be requested more than once.'

export const SESSION_REQUEST_AGENTS_DESCRIPTION =
  'Request approval for one or more child-agent launches. Repeat an agentId to launch multiple sessions from one profile. ' +
  'Every launch must include name (an agent-chosen human label, not the harness name) and role (for example, Reviewer or Implementer). ' +
  'config is optional; omitted model/effort fields inherit the selected profile defaultConfig, while explicit values override it. ' +
  'Session title becomes "Name - Role". The user reviews and may edit model/effort/AI provider/permission/sandbox (task, name, role, agent profile, cwd, worktree stay as requested). ' +
  'On approval each launch returns a bearer credential. Each credential can create exactly one session and must be kept private.'

/**
 * Field-level guidance, not part of the tool description: `session_collab_request`
 * is an always-visible built-in and its description is on a 700-char budget, but
 * the input schema is only read when the model actually fills the field in.
 * Both registration surfaces (JSON Schema for the Codex stdio bridge, Zod for the
 * in-process Claude server) must carry it — see superone-mcp-builtin-defs.test.ts.
 */
export const LAUNCH_PERMISSION_MODE_DESCRIPTION =
  'How autonomous the child session is. Prefer the most autonomous mode it can finish the task under — "bypassPermissions" (shown as Bypass on Claude-family harnesses, Full Access on Codex), or "auto" for ACP agents. ' +
  'Nobody watches a child session, so a conservative mode strands it on an approval prompt that is never answered. ' +
  'Requesting an autonomous mode is safe by construction: nothing runs until the user approves this very request, and that approval dialog is where they downgrade permission or sandbox per launch. ' +
  'Pick "plan" or "default" only when stopping for human review is the point of the launch.'

export const LAUNCH_BRANCH_NAME_DESCRIPTION =
  'Branch to create for this worktree. Must be unique across launches — git cannot check out one branch in two worktrees.'

export const SESSION_START_DESCRIPTION =
  'Create the real, user-visible collaboration child session authorized by one credential and deliver the approved launch task. ' +
  'Returns as soon as the child agent begins replying (does not wait for the full first turn). ' +
  'A credential creates at most one session; repeated calls are idempotent and return the same session id. ' +
  'The child then works asynchronously — start every child you need back to back, and never block on one before starting the next.'

export const SESSION_SEND_DESCRIPTION =
  'Send a persistent mailbox message between the parent and child sessions authorized by a credential. Direction is derived from the calling session. ' +
  'Write content as Markdown (headings, lists, code fences, emphasis, tables when useful) so peer agents and the SuperOne UI can render a structured handoff. ' +
  'Use clientMessageId for retry-safe idempotency. Delivery is push-based both ways: the peer is woken by a task notification (even mid-turn), and when it replies the host wakes you the same way — a fresh turn starts, telling you to call session_collab_retrieve. ' +
  'So after sending, move on to other work or end your turn; ending the turn IS how you wait here, and no reply is missed. Never sleep, re-send, or poll session_collab_retrieve while waiting.'

export const SESSION_RETRIEVE_DESCRIPTION =
  'Retrieve persistent mailbox messages addressed to this session. Non-blocking single read: returns the messages already waiting (status "messages") or nothing (status "empty"). ' +
  'Each message content is Markdown written by the peer — parse structure (headings, lists, code) rather than treating it as plain text. ' +
  'Pass multiple credentials to drain several parent/child mailboxes in one call. Returned messages advance only this agent endpoint cursor. ' +
  'Call it when a collaboration wake notification arrives, or once to drain the inbox before you act on peer input. ' +
  'Status "empty" means no peer has replied yet — it is NOT a retry signal: do not call again, do not sleep, do not spin. End your turn and the wake notification will start a new one the moment a message actually arrives.'

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
              agentId: { type: 'string', description: 'Agent profile id from session_collab_list_agents.' },
              task: { type: 'string', maxLength: 100000, description: 'The task shown to the user and delivered to this child session.' },
              name: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                description: 'Human-friendly label YOU invent for this child (e.g. "Alice", "DiffBot"). Not the harness name. Used in "Name - Role".',
              },
              role: {
                type: 'string',
                minLength: 1,
                maxLength: 64,
                description: 'Temporary role label for the child session title: "Name - Role" (e.g. "Reviewer", "Implementer").',
              },
              config: {
                type: 'object',
                properties: {
                  model: { type: 'string' },
                  effort: { type: 'string' },
                  apiProviderId: { type: ['string', 'null'] },
                  permissionMode: {
                    type: 'string',
                    enum: ['default', 'acceptEdits', 'bypassPermissions', 'plan', 'dontAsk', 'auto'],
                    description: LAUNCH_PERMISSION_MODE_DESCRIPTION,
                  },
                  sandboxMode: { type: 'string', enum: ['off', 'on', 'auto'] },
                  cwd: { type: 'string' },
                  worktree: {
                    type: 'object',
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
            required: ['agentId', 'task', 'name', 'role'],
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
      },
      required: ['title'],
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
